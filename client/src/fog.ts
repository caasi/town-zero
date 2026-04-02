// client/src/fog.ts
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
   * Uses Manhattan distance (diamond shape) to match server vision.
   * Only promotes tiles that already have a fog entry (explored or
   * previously visible) — does not reveal truly unknown tiles.
   */
  revealAround(cx: number, cy: number, radius: number): void {
    this.predictedVisible.clear();
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const key = `${cx + dx},${cy + dy}`;
        // Only promote tiles we've seen before — don't reveal truly unknown areas
        if (this.entries.has(key)) {
          this.predictedVisible.add(key);
        }
      }
    }
  }

  getLevel(x: number, y: number): FogLevel {
    const key = `${x},${y}`;
    // Predicted visible overrides "explored" back to "visible" within
    // the predicted vision radius. Tiles outside radius keep their
    // real fog level (explored stays grey, unknown stays dark).
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
