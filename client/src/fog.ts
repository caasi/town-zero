// client/src/fog.ts
import { tilesInManhattanRadius } from "@town-zero/shared";
import type { TerrainType, EntitySnapshot, ZoneType } from "@town-zero/shared";
import type { FogLevel, TileSnapshot, VisionData } from "./types.js";

/**
 * Fog-of-war manager using a snapshot model.
 *
 * Each tile the player has ever seen is stored as a TileSnapshot
 * (terrain + entities + timestamp). The fog level is derived:
 *   - in predictedVisible  → "visible"
 *   - has snapshot          → "explored"
 *   - otherwise             → "unknown"
 */
export class FogManager {
  private snapshots = new Map<string, TileSnapshot>();
  private predictedVisible = new Set<string>();
  private lastTick = 0;

  /** Authoritative update from server vision data. */
  update(vision: VisionData): void {
    this.lastTick = vision.tick;
    for (const [key, tile] of Object.entries(vision.tiles)) {
      // Merge with existing snapshot to preserve client-only fields
      // (resourceYield, zoneType, ownerFaction, structureId, operatorId, objectType)
      // that the server vision payload doesn't include.
      const existing = this.snapshots.get(key);
      this.snapshots.set(key, {
        terrain: tile.terrain,
        entities: tile.entities,
        timestamp: tile.timestamp,
        resourceYield: existing?.resourceYield,
        zoneType: existing?.zoneType,
        ownerFaction: existing?.ownerFaction,
        structureId: existing?.structureId,
        operatorId: existing?.operatorId,
        objectType: existing?.objectType,
      });
    }
  }

  /**
   * Set predicted-visible tiles and snapshot their live state.
   * Call once per frame before rendering.
   */
  revealAround(
    cx: number,
    cy: number,
    radius: number,
    tiles: { get(key: string): { terrain: string; resourceYield?: string; zoneType?: ZoneType; ownerFaction?: string; structureId?: string; operatorId?: string | null; objectType?: string } | undefined } | undefined,
    agents: Iterable<{ id: string; x: number; y: number; role: string; faction: string }>,
    localPlayerId: string | null,
  ): void {
    this.predictedVisible.clear();

    // Index agents by tile for entity snapshots
    const agentsByTile = new Map<string, EntitySnapshot[]>();
    for (const agent of agents) {
      if (agent.id === localPlayerId) continue;
      const key = `${agent.x},${agent.y}`;
      const arr = agentsByTile.get(key) ?? [];
      arr.push({
        id: agent.id,
        type:
          agent.role === "merchant"
            ? "merchant"
            : agent.faction.startsWith("den")
              ? "monster"
              : "agent",
        faction: agent.faction,
        position: { x: agent.x, y: agent.y },
      });
      agentsByTile.set(key, arr);
    }

    for (const pos of tilesInManhattanRadius({ x: cx, y: cy }, radius)) {
      const key = `${pos.x},${pos.y}`;
      this.predictedVisible.add(key);

      // Snapshot tile from live state using the last known server tick.
      // This keeps timestamp in consistent tick units across all snapshots.
      const tile = tiles?.get(key);
      if (tile) {
        this.snapshots.set(key, {
          terrain: tile.terrain as TerrainType,
          entities: agentsByTile.get(key) ?? [],
          timestamp: this.lastTick,
          resourceYield: tile.resourceYield,
          zoneType: tile.zoneType,
          ownerFaction: tile.ownerFaction,
          structureId: tile.structureId,
          operatorId: tile.operatorId,
          objectType: tile.objectType,
        });
      }
    }
  }

  getLevel(x: number, y: number): FogLevel {
    const key = `${x},${y}`;
    if (this.predictedVisible.has(key)) return "visible";
    if (this.snapshots.has(key)) return "explored";
    return "unknown";
  }

  /**
   * Returns a tile-source backed by fog snapshots (not raw server state).
   * Prediction should use this so it only knows about tiles the player
   * has actually seen — unknown tiles return undefined.
   *
   * The returned object is a **live view**: it captures `this.snapshots`
   * by reference, so lookups always reflect the latest fog state.
   * Callers should hold a single reference (set once at connect time)
   * rather than calling `tileSource()` repeatedly.
   */
  tileSource(): { get(key: string): { terrain: string } | undefined } {
    const snapshots = this.snapshots;
    return {
      get(key: string): { terrain: string } | undefined {
        const snapshot = snapshots.get(key);
        if (!snapshot) return undefined;
        return { terrain: snapshot.terrain };
      },
    };
  }

  getSnapshot(x: number, y: number): TileSnapshot | undefined {
    return this.snapshots.get(`${x},${y}`);
  }

  clear(): void {
    this.snapshots.clear();
    this.predictedVisible.clear();
  }
}
