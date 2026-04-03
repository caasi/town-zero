import { describe, it, expect } from "vitest";
import { Grid } from "../../src/simulation/grid.js";
import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";

describe("Grid", () => {
  it("creates grid with correct dimensions", () => {
    const grid = new Grid(GRID_WIDTH, GRID_HEIGHT);
    expect(grid.width).toBe(40);
    expect(grid.height).toBe(40);
  });

  it("gets and sets tile terrain", () => {
    const grid = new Grid(10, 10);
    grid.setTerrain(3, 4, "forest");
    expect(grid.getTerrain(3, 4)).toBe("forest");
  });

  it("returns null for out-of-bounds", () => {
    const grid = new Grid(10, 10);
    expect(grid.getTerrain(-1, 0)).toBeNull();
    expect(grid.getTerrain(10, 0)).toBeNull();
  });

  it("defaults all tiles to plains", () => {
    const grid = new Grid(5, 5);
    expect(grid.getTerrain(0, 0)).toBe("plains");
    expect(grid.getTerrain(4, 4)).toBe("plains");
  });

  it("returns cardinal neighbors", () => {
    const grid = new Grid(10, 10);
    const neighbors = grid.getNeighbors(5, 5);
    expect(neighbors).toHaveLength(4);
    expect(neighbors).toContainEqual({ x: 4, y: 5 });
    expect(neighbors).toContainEqual({ x: 6, y: 5 });
    expect(neighbors).toContainEqual({ x: 5, y: 4 });
    expect(neighbors).toContainEqual({ x: 5, y: 6 });
  });

  it("returns fewer neighbors at edges", () => {
    const grid = new Grid(10, 10);
    const neighbors = grid.getNeighbors(0, 0);
    expect(neighbors).toHaveLength(2);
  });

  it("checks adjacency", () => {
    const grid = new Grid(10, 10);
    expect(grid.isAdjacent({ x: 5, y: 5 }, { x: 5, y: 6 })).toBe(true);
    expect(grid.isAdjacent({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(false);
  });

  it("calculates manhattan distance", () => {
    const grid = new Grid(10, 10);
    expect(grid.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it("gets/sets tile owner", () => {
    const grid = new Grid(10, 10);
    expect(grid.getOwner(5, 5)).toBeNull();
    grid.setOwner(5, 5, "village-1");
    expect(grid.getOwner(5, 5)).toBe("village-1");
  });

  it("gets/sets resource yield", () => {
    const grid = new Grid(10, 10);
    expect(grid.getResourceYield(5, 5)).toBeNull();
    grid.setResourceYield(5, 5, "food");
    expect(grid.getResourceYield(5, 5)).toBe("food");
  });

  it("finds tiles within radius", () => {
    const grid = new Grid(10, 10);
    const tiles = grid.getTilesInRadius({ x: 5, y: 5 }, 1);
    expect(tiles).toHaveLength(5); // center + 4 cardinal
    expect(tiles).toContainEqual({ x: 5, y: 5 });
  });

  it("clips radius at map edges", () => {
    const grid = new Grid(10, 10);
    const tiles = grid.getTilesInRadius({ x: 0, y: 0 }, 1);
    expect(tiles).toHaveLength(3); // (0,0), (1,0), (0,1)
  });

  it("defaults zoneType to empty string", () => {
    const grid = new Grid(10, 10);
    expect(grid.getZoneType(5, 5)).toBe("");
  });

  it("gets and sets zoneType", () => {
    const grid = new Grid(10, 10);
    grid.setZoneType(3, 4, "housing");
    expect(grid.getZoneType(3, 4)).toBe("housing");
  });

  it("returns empty string for out-of-bounds zoneType", () => {
    const grid = new Grid(10, 10);
    expect(grid.getZoneType(-1, 0)).toBe("");
    expect(grid.getZoneType(10, 0)).toBe("");
  });

  it("ignores setZoneType for out-of-bounds", () => {
    const grid = new Grid(10, 10);
    grid.setZoneType(-1, 0, "core");
    expect(grid.getZoneType(-1, 0)).toBe("");
  });
});
