import { tilesInManhattanRadius } from "@town-zero/shared";
import type { TerrainType, EntitySnapshot, ZoneType } from "@town-zero/shared";
import type { FogLevel, TileSnapshot, VisionData } from "./types.js";

export class FogManager {
  private snapshots = new Map<string, TileSnapshot>();
  private predictedVisible = new Set<string>();
  private lastTick = 0;

  update(vision: VisionData): void {
    this.lastTick = vision.tick;
    for (const [key, tile] of Object.entries(vision.tiles)) {
      const existing = this.snapshots.get(key);
      this.snapshots.set(key, {
        terrain: tile.terrain,
        entities: tile.entities,
        timestamp: tile.timestamp,
        resourceYield: existing?.resourceYield,
        zoneType: existing?.zoneType,
        ownerFaction: existing?.ownerFaction,
        structureId: existing?.structureId,
        objectType: existing?.objectType,
      });
    }
  }

  revealAround(
    cx: number,
    cy: number,
    radius: number,
    tiles: { get(key: string): { terrain: string; resourceYield?: string; zoneType?: ZoneType; ownerFaction?: string; structureId?: string; objectType?: string } | undefined } | undefined,
    agents: Iterable<{ id: string; x: number; y: number; role: string; faction: string; hp: number; maxHp: number }>,
    localPlayerId: string | null,
  ): void {
    this.predictedVisible.clear();

    const agentsByTile = new Map<string, EntitySnapshot[]>();
    for (const agent of agents) {
      if (agent.id === localPlayerId) continue;
      const key = `${agent.x},${agent.y}`;
      const arr = agentsByTile.get(key) ?? [];
      arr.push({
        id: agent.id,
        type: agent.faction.startsWith("den") ? "monster" : "agent",
        faction: agent.faction,
        position: { x: agent.x, y: agent.y },
        role: agent.role,
        hp: agent.hp,
        maxHp: agent.maxHp,
      });
      agentsByTile.set(key, arr);
    }

    for (const pos of tilesInManhattanRadius({ x: cx, y: cy }, radius)) {
      const key = `${pos.x},${pos.y}`;
      this.predictedVisible.add(key);

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
