// client/src/fog.ts
import type { FogLevel, FogEntry, VisionData } from "./types.js";

export class FogManager {
  private entries = new Map<string, FogEntry>();

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

  getLevel(x: number, y: number): FogLevel {
    return this.entries.get(`${x},${y}`)?.level ?? "unknown";
  }

  getEntry(x: number, y: number): FogEntry | undefined {
    return this.entries.get(`${x},${y}`);
  }

  clear(): void {
    this.entries.clear();
  }
}
