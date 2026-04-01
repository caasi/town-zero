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
});
