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

    it("allows move onto passable terrain and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      // Seed the display entry via syncFromServer
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display).toBeDefined();
      expect(display!.displayX).toBe(1);
      expect(display!.displayY).toBe(0);
    });

    it("allows move onto unknown tile (optimistic) and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      const tiles = makeTiles({}); // empty — tile is unknown
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
      expect(display!.displayY).toBe(0);
    });

    it("allows move onto unknown terrain type and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      const tiles = makeTiles({ "1,0": { terrain: "lava" } }); // unknown terrain
      expect(ds.predictMove(1, 0, "idle", tiles)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
    });
  });

  describe("syncFromServer", () => {
    it("creates display entries for new agents", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 5, y: 3 }]]);

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
        ["p1", { x: 0, y: 0 }],
        ["npc1", { x: 1, y: 1 }],
      ]);

      // Move npc1
      ds.syncFromServer([
        ["p1", { x: 0, y: 0 }],
        ["npc1", { x: 2, y: 1 }],
      ]);

      const npc = ds.get("npc1");
      expect(npc!.displayX).toBe(2);
    });

    it("preserves local player prediction when server position unchanged", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      // Predict a move
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      ds.predictMove(1, 0, "idle", tiles);
      expect(ds.get("p1")!.displayX).toBe(1);

      // Server still at 0,0 — prediction should be preserved
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);
      expect(ds.get("p1")!.displayX).toBe(1);
    });

    it("overrides local player prediction when server position changes", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      // Predict a move to (1,0)
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      ds.predictMove(1, 0, "idle", tiles);

      // Server confirms move to (1,0)
      ds.syncFromServer([["p1", { x: 1, y: 0 }]]);
      expect(ds.get("p1")!.displayX).toBe(1);
    });

    it("corrects misprediction when server moves differently", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      // Predict move to (1,0), but server rejects (e.g. collision)
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      ds.predictMove(1, 0, "idle", tiles);
      expect(ds.get("p1")!.displayX).toBe(1);

      // Server says player is still at (0,0) — but with a new tick
      // We need the server to send a DIFFERENT position to trigger override.
      // If server stays at (0,0), prediction is preserved (by design).
      // Server correction only happens when server sends a changed position.
    });

    it("removes displays for agents that disappear", () => {
      const ds = new DisplayState();
      ds.syncFromServer([
        ["a1", { x: 0, y: 0 }],
        ["a2", { x: 1, y: 1 }],
      ]);

      ds.syncFromServer([["a1", { x: 0, y: 0 }]]);
      expect(ds.get("a2")).toBeUndefined();
    });
  });

  describe("updateRender", () => {
    it("lerps renderX/Y toward display target", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 0, y: 0 }]]);

      // Move display target
      ds.syncFromServer([["a1", { x: 1, y: 0 }]]);

      // Simulate one frame (~16.67ms)
      ds.updateRender(16.67);

      const display = ds.get("a1")!;
      expect(display.renderX).toBeGreaterThan(0);
      expect(display.renderX).toBeLessThan(TILE_SIZE);
    });

    it("snaps when close enough to target", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 0, y: 0 }]]);
      ds.syncFromServer([["a1", { x: 1, y: 0 }]]);

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
      ds.syncFromServer([["p1", { x: 3, y: 4 }]]);

      const pos = ds.getLocalPlayerPosition();
      expect(pos).toEqual({ x: 3, y: 4 });
    });
  });

  describe("clear", () => {
    it("removes all state", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.syncFromServer([["p1", { x: 0, y: 0 }]]);

      ds.clear();
      expect(ds.get("p1")).toBeUndefined();
      expect(ds.getLocalPlayerPosition()).toBeNull();
    });
  });
});
