import { describe, it, expect } from "vitest";
import { FogManager } from "../src/fog.js";
import type { TerrainType } from "@town-zero/shared";

function makeLiveTiles(
  entries: Record<string, { terrain: string; resourceYield?: string }>,
) {
  return {
    get(key: string) {
      return entries[key];
    },
  };
}

function noAgents(): Iterable<{ id: string; x: number; y: number; role: string; faction: string }> {
  return [];
}

describe("FogManager", () => {
  describe("getLevel", () => {
    it("returns unknown for tiles never seen", () => {
      const fog = new FogManager();
      expect(fog.getLevel(5, 5)).toBe("unknown");
    });

    it("returns explored after server vision update", () => {
      const fog = new FogManager();
      fog.update({
        tick: 1,
        tiles: {
          "3,3": { terrain: "plains" as TerrainType, entities: [], timestamp: 1 },
        },
      });

      expect(fog.getLevel(3, 3)).toBe("explored");
    });

    it("returns visible for predicted-visible tiles", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({ "0,0": { terrain: "plains" } });
      fog.revealAround(0, 0, 1, tiles, noAgents(), null);

      expect(fog.getLevel(0, 0)).toBe("visible");
    });

    it("demotes to explored when no longer in predicted-visible set", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({
        "0,0": { terrain: "plains" },
        "1,0": { terrain: "forest" },
        "3,0": { terrain: "plains" },
      });

      // First reveal around (0,0) with radius 1
      fog.revealAround(0, 0, 1, tiles, noAgents(), null);
      expect(fog.getLevel(0, 0)).toBe("visible");

      // Move to (3,0) — (0,0) should become explored
      fog.revealAround(3, 0, 1, tiles, noAgents(), null);
      expect(fog.getLevel(0, 0)).toBe("explored");
      expect(fog.getLevel(3, 0)).toBe("visible");
    });
  });

  describe("revealAround", () => {
    it("snapshots tiles from live state with non-zero timestamp", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({ "2,2": { terrain: "forest" } });

      fog.revealAround(2, 2, 0, tiles, noAgents(), null);

      const snapshot = fog.getSnapshot(2, 2);
      expect(snapshot).toBeDefined();
      expect(snapshot!.terrain).toBe("forest");
      expect(snapshot!.timestamp).toBeGreaterThan(0);
    });

    it("captures resourceYield in snapshot", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({
        "1,1": { terrain: "plains", resourceYield: "food" },
      });

      fog.revealAround(1, 1, 0, tiles, noAgents(), null);

      const snapshot = fog.getSnapshot(1, 1);
      expect(snapshot!.resourceYield).toBe("food");
    });

    it("captures agent entities in snapshot, excluding local player", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({ "0,0": { terrain: "plains" } });
      const agents = [
        { id: "p1", x: 0, y: 0, role: "player", faction: "v1" },
        { id: "npc1", x: 0, y: 0, role: "farmer", faction: "v1" },
      ];

      fog.revealAround(0, 0, 0, tiles, agents, "p1");

      const snapshot = fog.getSnapshot(0, 0);
      expect(snapshot!.entities).toHaveLength(1);
      expect(snapshot!.entities[0].id).toBe("npc1");
    });

    it("uses Manhattan distance for visibility shape", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({
        "0,0": { terrain: "plains" },
        "1,0": { terrain: "plains" },
        "0,1": { terrain: "plains" },
        "1,1": { terrain: "plains" },
        "-1,0": { terrain: "plains" },
        "0,-1": { terrain: "plains" },
      });

      fog.revealAround(0, 0, 1, tiles, noAgents(), null);

      // Manhattan distance 1: (0,0), (1,0), (-1,0), (0,1), (0,-1)
      expect(fog.getLevel(0, 0)).toBe("visible");
      expect(fog.getLevel(1, 0)).toBe("visible");
      expect(fog.getLevel(-1, 0)).toBe("visible");
      expect(fog.getLevel(0, 1)).toBe("visible");
      expect(fog.getLevel(0, -1)).toBe("visible");

      // Manhattan distance 2: (1,1) — NOT visible at radius 1
      expect(fog.getLevel(1, 1)).toBe("unknown");
    });

    it("does not snapshot tiles not in live state", () => {
      const fog = new FogManager();
      const tiles = makeLiveTiles({}); // no tiles

      fog.revealAround(0, 0, 1, tiles, noAgents(), null);

      // Tiles are predicted-visible but have no snapshot data
      expect(fog.getLevel(0, 0)).toBe("visible");
      expect(fog.getSnapshot(0, 0)).toBeUndefined();
    });
  });

  describe("tileSource", () => {
    it("returns terrain from fog snapshots", () => {
      const fog = new FogManager();
      fog.update({
        tick: 1,
        tiles: {
          "2,3": { terrain: "mountain" as TerrainType, entities: [], timestamp: 1 },
        },
      });

      const source = fog.tileSource();
      expect(source.get("2,3")?.terrain).toBe("mountain");
    });

    it("returns undefined for unknown tiles", () => {
      const fog = new FogManager();
      const source = fog.tileSource();
      expect(source.get("99,99")).toBeUndefined();
    });

    it("is a live view that reflects later updates", () => {
      const fog = new FogManager();
      const source = fog.tileSource();

      expect(source.get("1,1")).toBeUndefined();

      fog.update({
        tick: 1,
        tiles: {
          "1,1": { terrain: "road" as TerrainType, entities: [], timestamp: 1 },
        },
      });

      expect(source.get("1,1")?.terrain).toBe("road");
    });
  });

  describe("clear", () => {
    it("removes all snapshots and predicted-visible state", () => {
      const fog = new FogManager();
      fog.update({
        tick: 1,
        tiles: {
          "0,0": { terrain: "plains" as TerrainType, entities: [], timestamp: 1 },
        },
      });
      const tiles = makeLiveTiles({ "0,0": { terrain: "plains" } });
      fog.revealAround(0, 0, 0, tiles, noAgents(), null);

      fog.clear();

      expect(fog.getLevel(0, 0)).toBe("unknown");
      expect(fog.getSnapshot(0, 0)).toBeUndefined();
    });
  });
});
