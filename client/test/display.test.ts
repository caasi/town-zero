import { describe, it, expect } from "vitest";
import { DisplayState } from "../src/display.js";
import { TILE_SIZE } from "../src/constants.js";

function makeTiles(entries: Record<string, { terrain: string }>) {
  return {
    get(key: string) {
      return entries[key];
    },
  };
}

describe("DisplayState", () => {
  describe("predictMove", () => {
    it("rejects when no local player is set", () => {
      const ds = new DisplayState();
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(false);
    });

    it("rejects when agent is not idle", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "gathering", tiles)).toBe(false);
    });

    it("rejects move onto known impassable terrain (water)", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({ "1,0": { terrain: "water" } });
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(false);
    });

    it("allows move in same facing direction and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      const tiles = makeTiles({ "0,1": { terrain: "plains" } });
      expect(ds.predictMove(0, 1, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display).toBeDefined();
      expect(display!.displayX).toBe(0);
      expect(display!.displayY).toBe(1);
    });

    it("turn-before-move: changes facing without moving when direction differs", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display!.facing).toBe("east");
      expect(display!.displayX).toBe(0); // didn't move
    });

    it("turn-before-move: moves after facing matches", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      // First call turns east
      ds.predictMove(1, 0, "idle", tiles);
      // Second call moves (now facing east)
      ds.predictMove(1, 0, "idle", tiles);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
      expect(display!.displayY).toBe(0);
    });

    it("allows move onto unknown tile (optimistic) and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      // Facing south, move south
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      const tiles = makeTiles({}); // empty — tile is unknown
      expect(ds.predictMove(0, 1, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(0);
      expect(display!.displayY).toBe(1);
    });

    it("allows move onto unknown terrain type and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      // Facing east, move east
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "east" }]]);

      const tiles = makeTiles({ "1,0": { terrain: "lava" } }); // unknown terrain
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
    });
  });

  describe("syncFromServer", () => {
    it("creates display entries for new agents", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 5, y: 3, facing: "south" }]]);

      const display = ds.get("a1");
      expect(display).toBeDefined();
      expect(display!.displayX).toBe(5);
      expect(display!.displayY).toBe(3);
      expect(display!.renderX).toBe(5 * TILE_SIZE);
      expect(display!.renderY).toBe(3 * TILE_SIZE);
    });

    it("updates non-local agents immediately", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([
        ["p1", { x: 0, y: 0, facing: "south" }],
        ["npc1", { x: 1, y: 1, facing: "south" }],
      ]);

      // Move npc1
      ds.syncFromServer([
        ["p1", { x: 0, y: 0, facing: "south" }],
        ["npc1", { x: 2, y: 1, facing: "south" }],
      ]);

      const npc = ds.get("npc1");
      expect(npc!.displayX).toBe(2);
    });

    it("preserves local player prediction when server position unchanged", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      // Predict a move south (same as facing → actually moves)
      const tiles = makeTiles({ "0,1": { terrain: "plains" } });
      ds.predictMove(0, 1, "idle", tiles);
      expect(ds.get("p1")!.displayY).toBe(1);

      // Server still at 0,0 — prediction should be preserved
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);
      expect(ds.get("p1")!.displayY).toBe(1);
    });

    it("overrides local player prediction when server position changes", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      // Predict a move south
      const tiles = makeTiles({ "0,1": { terrain: "plains" } });
      ds.predictMove(0, 1, "idle", tiles);

      // Server confirms move to (0,1)
      ds.syncFromServer([["p1", { x: 0, y: 1, facing: "south" }]]);
      expect(ds.get("p1")!.displayY).toBe(1);
    });

    it("corrects misprediction when server moves differently", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      // Predict move south
      const tiles = makeTiles({ "0,1": { terrain: "plains" } });
      ds.predictMove(0, 1, "idle", tiles);
      expect(ds.get("p1")!.displayY).toBe(1);

      // Server sends a different authoritative position
      ds.syncFromServer([["p1", { x: 1, y: 0, facing: "east" }]]);

      const player = ds.get("p1");
      expect(player!.displayX).toBe(1);
      expect(player!.displayY).toBe(0);
    });

    it("removes displays for agents that disappear", () => {
      const ds = new DisplayState();
      ds.syncFromServer([
        ["a1", { x: 0, y: 0, facing: "south" }],
        ["a2", { x: 1, y: 1, facing: "south" }],
      ]);

      ds.syncFromServer([["a1", { x: 0, y: 0, facing: "south" }]]);
      expect(ds.get("a2")).toBeUndefined();
    });
  });

  describe("updateRender", () => {
    it("lerps renderX/Y toward display target", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 0, y: 0, facing: "south" }]]);

      // Move display target
      ds.syncFromServer([["a1", { x: 1, y: 0, facing: "south" }]]);

      // Simulate one frame (~16.67ms)
      ds.updateRender(16.67);

      const display = ds.get("a1")!;
      expect(display.renderX).toBeGreaterThan(0);
      expect(display.renderX).toBeLessThan(TILE_SIZE);
    });

    it("snaps when close enough to target", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 0, y: 0, facing: "south" }]]);
      ds.syncFromServer([["a1", { x: 1, y: 0, facing: "south" }]]);

      // Run many frames to converge
      for (let i = 0; i < 60; i++) {
        ds.updateRender(16.67);
      }

      const display = ds.get("a1")!;
      expect(display.renderX).toBe(TILE_SIZE);
    });
  });

  describe("getLocalPlayerPosition", () => {
    it("returns null when no local player", () => {
      const ds = new DisplayState();
      expect(ds.getLocalPlayerPosition()).toBeNull();
    });

    it("returns predicted position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 3, y: 4, facing: "south" }]]);

      const pos = ds.getLocalPlayerPosition();
      expect(pos).toEqual({ x: 3, y: 4 });
    });
  });

  describe("clear", () => {
    it("removes all state", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

      ds.clear();
      expect(ds.get("p1")).toBeUndefined();
      expect(ds.getLocalPlayerPosition()).toBeNull();
    });
  });
});
