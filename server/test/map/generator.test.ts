import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/map/generator.js";
import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";

describe("generateMap", () => {
  it("creates a SimulationState with correct grid size", () => {
    const state = generateMap();
    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
  });

  it("places exactly one village settlement", () => {
    const state = generateMap();
    const villages = Array.from(state.settlements.values()).filter((s) => s.type === "village");
    expect(villages).toHaveLength(1);
  });

  it("places exactly one monster den", () => {
    const state = generateMap();
    const dens = Array.from(state.settlements.values()).filter((s) => s.type === "den");
    expect(dens).toHaveLength(1);
  });

  it("creates village agents", () => {
    const state = generateMap();
    const villageAgents = Array.from(state.agents.values()).filter((a) => a.faction.startsWith("village"));
    expect(villageAgents.length).toBeGreaterThan(0);
    expect(villageAgents.length).toBeLessThanOrEqual(10);
  });

  it("creates monster agents", () => {
    const state = generateMap();
    const monsterAgents = Array.from(state.agents.values()).filter((a) => a.faction.startsWith("den"));
    expect(monsterAgents.length).toBeGreaterThan(0);
  });

  it("places resource tiles on the map", () => {
    const state = generateMap();
    let resourceCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (state.grid.getResourceYield(x, y)) resourceCount++;
      }
    }
    expect(resourceCount).toBeGreaterThan(0);
  });

  it("places a road (trade route)", () => {
    const state = generateMap();
    let roadCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (state.grid.getTerrain(x, y) === "road") roadCount++;
      }
    }
    expect(roadCount).toBeGreaterThan(0);
  });

  it("village has housing and production structures", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    expect(village.structures.some((s) => s.type === "housing")).toBe(true);
    expect(village.structures.some((s) => s.type === "production")).toBe(true);
  });

  it("gives village starting resources", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    expect(village.inventory.food).toBeGreaterThan(0);
  });

  it("village has a core structure", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    expect(village.structures.some((s) => s.type === "core")).toBe(true);
  });

  it("den has a core structure", () => {
    const state = generateMap();
    const den = Array.from(state.settlements.values()).find((s) => s.type === "den")!;
    expect(den.structures.some((s) => s.type === "core")).toBe(true);
  });

  it("sets zoneType on grid tiles for village territory", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    const core = village.structures.find((s) => s.type === "core")!;
    expect(state.grid.getZoneType(core.position.x, core.position.y)).toBe("core");
  });

  it("places bush tiles east of village with food yield", () => {
    const state = generateMap();
    // Bush positions are relative to village center (10, 20)
    const expectedBushes = [
      { x: 14, y: 19 },
      { x: 14, y: 20 },
      { x: 15, y: 20 },
      { x: 15, y: 21 },
      { x: 14, y: 21 },
    ];
    for (const pos of expectedBushes) {
      expect(state.grid.getObjectType(pos.x, pos.y)).toBe("bush");
      expect(state.grid.getResourceYield(pos.x, pos.y)).toBe("food");
    }
  });

  it("sets ownerFaction on all village territory tiles", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    for (const pos of village.territory) {
      expect(state.grid.getOwner(pos.x, pos.y)).toBe(village.faction);
    }
  });
});
