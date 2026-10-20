import { describe, it, expect } from "vitest";
import { DisplayState } from "../src/display.js";
import { TILE_SIZE } from "../src/constants.js";
import { TICK_RATE_MS, type InputFrame } from "@town-zero/shared";

function makeTiles(entries: Record<string, { terrain: string }>) {
  return {
    get(key: string) {
      return entries[key];
    },
  };
}

function initLocal(
  ds: DisplayState,
  id: string,
  pos: { x: number; y: number; facing: string },
): void {
  ds.setTileSource(makeTiles({}));
  ds.reconcileFromServer(id, {
    x: pos.x, y: pos.y, facing: pos.facing,
    lastProcessedInput: 0, state: "idle",
  }, []);
}

describe("DisplayState", () => {
  describe("predictMove", () => {
    it("rejects when no local player is set", () => {
      const ds = new DisplayState();
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "idle", tiles, 0)).toBe(false);
    });

    it("rejects when agent is not idle", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "gathering", tiles, 0)).toBe(false);
    });

    it("rejects move onto known impassable terrain (water)", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({ "1,0": { terrain: "water" } });
      expect(ds.predictMove(1, 0, "idle", tiles, 0)).toBe(false);
    });

    it.each([
      ["west", { x: 0, y: 5 }, { x: -1, y: 5 }],
      ["east", { x: 9, y: 5 }, { x: 10, y: 5 }],
      ["north", { x: 5, y: 0 }, { x: 5, y: -1 }],
      ["south", { x: 5, y: 9 }, { x: 5, y: 10 }],
    ])("rejects a move off the %s map edge (the tile is never in fog memory)", (facing, from, to) => {
      const ds = new DisplayState();
      ds.setGridSize(10, 10);
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { ...from, facing });
      expect(ds.predictMove(to.x, to.y, "idle", makeTiles({}), 0)).toBe(false);
      expect(ds.get("p1")).toMatchObject({ displayX: from.x, displayY: from.y });
    });

    it("keeps the map size through clear(), which a revive calls", () => {
      const ds = new DisplayState();
      ds.setGridSize(10, 10);
      ds.clear();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 9, y: 5, facing: "east" });
      expect(ds.predictMove(10, 5, "idle", makeTiles({}), 0)).toBe(false);
    });

    it("has no east or south edge before the map size is known", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 9, y: 5, facing: "east" });
      expect(ds.predictMove(10, 5, "idle", makeTiles({}), 0)).toBe(true);
    });

    it("allows move in same facing direction and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "south" });

      const tiles = makeTiles({ "0,1": { terrain: "plains" } });
      expect(ds.predictMove(0, 1, "idle", tiles, 0)).toBe(true);

      const display = ds.get("p1");
      expect(display).toBeDefined();
      expect(display!.displayX).toBe(0);
      expect(display!.displayY).toBe(1);
    });

    it("turn-before-move: changes facing without moving when direction differs", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "south" });

      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      expect(ds.predictMove(1, 0, "idle", tiles, 0)).toBe(true);

      const display = ds.get("p1");
      expect(display!.facing).toBe("east");
      expect(display!.displayX).toBe(0);
    });

    it("turn-before-move: moves after facing matches", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "south" });

      const tiles = makeTiles({ "1,0": { terrain: "plains" } });
      ds.predictMove(1, 0, "idle", tiles, 0);
      ds.predictMove(1, 0, "idle", tiles, 0);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
      expect(display!.displayY).toBe(0);
    });

    it("allows move onto unknown tile (optimistic) and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "south" });

      const tiles = makeTiles({});
      expect(ds.predictMove(0, 1, "idle", tiles, 0)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(0);
      expect(display!.displayY).toBe(1);
    });

    it("allows move onto unknown terrain type and updates display position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "east" });

      const tiles = makeTiles({ "1,0": { terrain: "lava" } });
      expect(ds.predictMove(1, 0, "idle", tiles, 0)).toBe(true);

      const display = ds.get("p1");
      expect(display!.displayX).toBe(1);
    });
  });

  describe("reconcileFromServer", () => {
    it("does not replay a move off the map edge", () => {
      const ds = new DisplayState();
      ds.setGridSize(10, 10);
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "west" });
      const pending: InputFrame[] = [{ seq: 1, direction: "west" }];
      ds.reconcileFromServer("p1", { x: 0, y: 0, facing: "west", lastProcessedInput: 0, state: "idle" }, pending);
      expect(ds.get("p1")).toMatchObject({ displayX: 0, displayY: 0 });
    });

    it("with no pending inputs, display equals server position", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({ "0,0": { terrain: "plains" } });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [];
      const remaining = ds.reconcileFromServer("p1",
        { x: 3, y: 4, facing: "south", lastProcessedInput: 0, state: "idle" },
        pending,
      );
      expect(remaining).toEqual([]);
      expect(ds.get("p1")!.displayX).toBe(3);
      expect(ds.get("p1")!.displayY).toBe(4);
    });

    it("prunes acknowledged inputs and replays remaining", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({
        "3,4": { terrain: "plains" },
        "3,5": { terrain: "plains" },
        "3,6": { terrain: "plains" },
      });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "south" },
        { seq: 2, direction: "south" },
        { seq: 3, direction: "south" },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 3, y: 4, facing: "south", lastProcessedInput: 1, state: "idle" },
        pending,
      );
      expect(remaining).toHaveLength(2);
      expect(remaining[0].seq).toBe(2);
      expect(ds.get("p1")!.displayX).toBe(3);
      expect(ds.get("p1")!.displayY).toBe(6);
    });

    it("skips replay for frames with action even if direction is also present", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({
        "3,4": { terrain: "plains" },
        "3,5": { terrain: "plains" },
      });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "south", action: { type: "idle" } },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 3, y: 4, facing: "south", lastProcessedInput: 0, state: "idle" },
        pending,
      );
      expect(remaining).toHaveLength(1);
      expect(ds.get("p1")!.displayY).toBe(4);
    });

    it("replays turn-before-move correctly", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({
        "0,0": { terrain: "plains" },
        "1,0": { terrain: "plains" },
      });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "east" },
        { seq: 2, direction: "east" },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "idle" },
        pending,
      );
      expect(remaining).toHaveLength(2);
      expect(ds.get("p1")!.displayX).toBe(1);
      expect(ds.get("p1")!.facing).toBe("east");
    });

    it("server rejection undoes predicted move", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({
        "0,0": { terrain: "plains" },
        "1,0": { terrain: "water" },
      });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "east" },
        { seq: 2, direction: "east" },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 0, y: 0, facing: "east", lastProcessedInput: 1, state: "idle" },
        pending,
      );
      expect(remaining).toHaveLength(1);
      expect(ds.get("p1")!.displayX).toBe(0);
      expect(ds.get("p1")!.facing).toBe("east");
    });

    it("action frames in pending buffer preserve seq continuity for pruning", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({
        "3,4": { terrain: "plains" },
        "3,5": { terrain: "plains" },
        "3,6": { terrain: "plains" },
      });
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "south" },
        { seq: 2, action: { type: "attack", targetId: "e1" } },
        { seq: 3, direction: "south" },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 3, y: 4, facing: "south", lastProcessedInput: 2, state: "idle" },
        pending,
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0].seq).toBe(3);
      expect(ds.get("p1")!.displayY).toBe(5);
    });

    it("clears pending when agent state is not idle", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      const tiles = makeTiles({});
      ds.setTileSource(tiles);

      const pending: InputFrame[] = [
        { seq: 1, direction: "south" },
        { seq: 2, direction: "south" },
      ];
      const remaining = ds.reconcileFromServer("p1",
        { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "fighting" },
        pending,
      );
      expect(remaining).toEqual([]);
      expect(ds.get("p1")!.displayX).toBe(0);
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

      ds.syncFromServer([
        ["p1", { x: 0, y: 0, facing: "south" }],
        ["npc1", { x: 2, y: 1, facing: "south" }],
      ]);

      const npc = ds.get("npc1");
      expect(npc!.displayX).toBe(2);
    });

    it("skips local player (handled by reconcileFromServer)", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      ds.setTileSource(makeTiles({}));
      ds.reconcileFromServer("p1",
        { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "idle" },
        [],
      );

      ds.syncFromServer([["p1", { x: 5, y: 5, facing: "north" }]]);
      expect(ds.get("p1")!.displayX).toBe(0);
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

      ds.syncFromServer([["a1", { x: 1, y: 0, facing: "south" }]]);

      ds.updateRender(16.67, 0);

      const display = ds.get("a1")!;
      expect(display.renderX).toBeGreaterThan(0);
      expect(display.renderX).toBeLessThan(TILE_SIZE);
    });

    it("moves the local player at a constant speed along a predicted step", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 1000);

      ds.updateRender(16, 1000 + TICK_RATE_MS / 4);
      expect(ds.get("me")!.renderX).toBeCloseTo(TILE_SIZE / 4);
      ds.updateRender(16, 1000 + TICK_RATE_MS / 2);
      expect(ds.get("me")!.renderX).toBeCloseTo(TILE_SIZE / 2);
      ds.updateRender(16, 1000 + TICK_RATE_MS);
      expect(ds.get("me")!.renderX).toBe(TILE_SIZE);
    });

    it("goes on to the next predicted step without a stop", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 1000);
      ds.updateRender(16, 1000 + TICK_RATE_MS - 10);
      ds.predictMove(2, 0, "idle", makeTiles({}), 1000 + TICK_RATE_MS);

      ds.updateRender(16, 1000 + TICK_RATE_MS + TICK_RATE_MS / 2);
      expect(ds.get("me")!.renderX).toBeCloseTo(1.5 * TILE_SIZE);
    });

    it("starts the next step from where the player is drawn after a server correction", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 0);
      ds.updateRender(16, TICK_RATE_MS / 2);
      ds.reconcileFromServer("me", { x: 0, y: 0, facing: "east", lastProcessedInput: 0, state: "idle" }, []);
      ds.updateRender(16, TICK_RATE_MS / 2 + 16);
      const drawnAt = ds.get("me")!.renderX;
      expect(drawnAt).toBeGreaterThan(0);

      ds.predictMove(1, 0, "idle", makeTiles({}), TICK_RATE_MS);
      ds.updateRender(16, TICK_RATE_MS);
      expect(ds.get("me")!.renderX).toBeCloseTo(drawnAt);
    });

    it("eases a later server move back onto a tile that a finished step predicted", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 0);
      ds.updateRender(16, TICK_RATE_MS);
      const server = { facing: "east", lastProcessedInput: 1, state: "idle" };
      ds.reconcileFromServer("me", { ...server, x: 3, y: 0 }, []);
      for (let t = 1; t <= 30; t++) ds.updateRender(16, TICK_RATE_MS + 16 * t);
      ds.reconcileFromServer("me", { ...server, x: 1, y: 0 }, []);
      ds.updateRender(16, TICK_RATE_MS + 16 * 31);
      expect(ds.get("me")!.renderX).toBeGreaterThan(TILE_SIZE);
    });

    it("eases toward the corrected tile when the server rejects a predicted step", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 0);
      ds.updateRender(16, TICK_RATE_MS / 2);
      ds.reconcileFromServer("me", { x: 0, y: 0, facing: "east", lastProcessedInput: 1, state: "idle" }, []);
      ds.updateRender(16, TICK_RATE_MS / 2 + 16);
      expect(ds.get("me")!.renderX).toBeLessThan(TILE_SIZE / 2);
    });

    it("moves the same distance in each frame across the end of a step", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      const frameMs = 1000 / 60;
      let nextStep = 0;
      let x = 0;
      const deltas: number[] = [];
      for (let frame = 0; frame < 40; frame++) {
        const now = frame * frameMs;
        if (now >= nextStep) {
          ds.predictMove(++x, 0, "idle", makeTiles({}), nextStep);
          nextStep += TICK_RATE_MS;
        }
        const before = ds.get("me")!.renderX;
        ds.updateRender(frameMs, now);
        if (frame > 0) deltas.push(ds.get("me")!.renderX - before);
      }
      const perFrame = (TILE_SIZE / TICK_RATE_MS) * frameMs;
      for (const d of deltas) expect(d).toBeCloseTo(perFrame, 5);
    });

    it("forgets the predicted step on clear()", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 0, y: 0, facing: "east" });
      ds.predictMove(1, 0, "idle", makeTiles({}), 0);
      ds.clear();
      ds.setLocalPlayer("me");
      initLocal(ds, "me", { x: 1, y: 0, facing: "east" });
      ds.updateRender(16, 0);
      expect(ds.get("me")!.renderX).toBe(TILE_SIZE);
    });

    it("snaps when close enough to target", () => {
      const ds = new DisplayState();
      ds.syncFromServer([["a1", { x: 0, y: 0, facing: "south" }]]);
      ds.syncFromServer([["a1", { x: 1, y: 0, facing: "south" }]]);

      for (let i = 0; i < 60; i++) {
        ds.updateRender(16.67, 0);
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
      initLocal(ds, "p1", { x: 3, y: 4, facing: "south" });

      const pos = ds.getLocalPlayerPosition();
      expect(pos).toEqual({ x: 3, y: 4 });
    });
  });

  describe("clear", () => {
    it("removes all state", () => {
      const ds = new DisplayState();
      ds.setLocalPlayer("p1");
      initLocal(ds, "p1", { x: 0, y: 0, facing: "south" });

      ds.clear();
      expect(ds.get("p1")).toBeUndefined();
      expect(ds.getLocalPlayerPosition()).toBeNull();
    });
  });
});
