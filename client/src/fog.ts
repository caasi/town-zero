// client/src/fog.ts
import { tilesInManhattanRadius } from "@town-zero/shared";
import type { TerrainType } from "@town-zero/shared";
import type { EntitySnapshot } from "@town-zero/shared";
import type { FogLevel, FogEntry, VisionData } from "./types.js";

export class FogManager {
  private entries = new Map<string, FogEntry>();
  // Tiles temporarily promoted to "visible" by client-side prediction.
  // Rebuilt every frame so it never outlives the prediction.
  private predictedVisible = new Set<string>();

  update(vision: VisionData): void {
    const currentTick = vision.tick;
    for (const [key, tile] of Object.entries(vision.tiles)) {
      this.entries.set(key, {
        level: tile.timestamp === currentTick ? "visible" : "explored",
        terrain: tile.terrain,
        lastEntities: tile.entities,
        timestamp: tile.timestamp,
      });
    }
  }

  /**
   * Optimistically mark tiles around a predicted position as "visible".
   * Uses tilesInManhattanRadius (shared with server) for consistent shape.
   * Snapshots tile data from live state so tiles transition to "explored"
   * (not "unknown") when they leave the predicted radius.
   */
  revealAround(
    cx: number,
    cy: number,
    radius: number,
    tiles?: { get(key: string): { terrain: string } | undefined },
  ): void {
    this.predictedVisible.clear();
    for (const pos of tilesInManhattanRadius({ x: cx, y: cy }, radius)) {
      const key = `${pos.x},${pos.y}`;
      this.predictedVisible.add(key);

      // Snapshot from live state for tiles we haven't seen via server vision yet.
      // When these tiles leave predicted radius, they become "explored" instead
      // of "unknown" because they now have an entry.
      if (tiles && !this.entries.has(key)) {
        const tile = tiles.get(key);
        if (tile) {
          this.entries.set(key, {
            level: "explored",
            terrain: tile.terrain as TerrainType,
            lastEntities: [],
            timestamp: 0,
          });
        }
      }
    }
  }

  /**
   * Update lastEntities for predicted-visible tiles from live agent state.
   * This ensures mobs are remembered at their last-seen position when
   * tiles transition from visible to explored.
   */
  snapshotAgents(
    agents: Iterable<{ id: string; x: number; y: number; role: string; faction: string }>,
    localPlayerId: string | null,
  ): void {
    // Index agents by tile key, only for predicted-visible tiles
    const byTile = new Map<string, EntitySnapshot[]>();
    for (const agent of agents) {
      if (agent.id === localPlayerId) continue;
      const key = `${agent.x},${agent.y}`;
      if (!this.predictedVisible.has(key)) continue;
      const arr = byTile.get(key) ?? [];
      arr.push({
        id: agent.id,
        type: agent.role === "merchant" ? "merchant" : "agent",
        faction: agent.faction,
        position: { x: agent.x, y: agent.y },
      });
      byTile.set(key, arr);
    }
    // Update entries for all predicted-visible tiles
    for (const key of this.predictedVisible) {
      const entry = this.entries.get(key);
      if (entry) {
        entry.lastEntities = byTile.get(key) ?? [];
      }
    }
  }

  getLevel(x: number, y: number): FogLevel {
    const key = `${x},${y}`;
    if (this.predictedVisible.has(key)) return "visible";
    const entry = this.entries.get(key);
    if (!entry) return "unknown";
    // Outside predicted radius: demote stale "visible" to "explored"
    // so tiles the player walked away from show as grey
    if (entry.level === "visible") return "explored";
    return entry.level;
  }

  getEntry(x: number, y: number): FogEntry | undefined {
    return this.entries.get(`${x},${y}`);
  }

  clear(): void {
    this.entries.clear();
    this.predictedVisible.clear();
  }
}
