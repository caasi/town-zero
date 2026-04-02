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
   * Optimistically reveal tiles around a predicted position.
   * Call once per frame before rendering. Only promotes already-explored
   * or unknown tiles to "visible" temporarily — the real fog state is
   * unchanged and next server vision will overwrite as usual.
   */
  revealAround(cx: number, cy: number, radius: number): void {
    this.predictedVisible.clear();
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        this.predictedVisible.add(`${cx + dx},${cy + dy}`);
      }
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
