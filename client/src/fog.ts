// client/src/fog.ts
import { tilesInManhattanRadius } from "@town-zero/shared";
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
   */
  revealAround(cx: number, cy: number, radius: number): void {
    this.predictedVisible.clear();
    for (const pos of tilesInManhattanRadius({ x: cx, y: cy }, radius)) {
      this.predictedVisible.add(`${pos.x},${pos.y}`);
    }
  }

  getLevel(x: number, y: number): FogLevel {
    const key = `${x},${y}`;
    if (this.predictedVisible.has(key)) return "visible";
    return this.entries.get(key)?.level ?? "unknown";
  }

  getEntry(x: number, y: number): FogEntry | undefined {
    return this.entries.get(`${x},${y}`);
  }

  clear(): void {
    this.entries.clear();
    this.predictedVisible.clear();
  }
}
