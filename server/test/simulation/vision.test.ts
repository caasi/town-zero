import { describe, it, expect } from "vitest";
import { updateVision, mergeAdjacentMemories } from "../../src/simulation/vision.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { DEFAULT_VISION_RADIUS } from "@town-zero/shared";

describe("updateVision", () => {
  it("records tiles within vision radius", () => {
    const grid = new Grid(20, 20);
    grid.setTerrain(6, 5, "forest");
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const allAgents = new Map([["a1", agent]]);

    updateVision(agent, grid, allAgents, 10);

    const mem = agent.getMemory(6, 5);
    expect(mem).not.toBeNull();
    expect(mem!.terrain).toBe("forest");
    expect(mem!.timestamp).toBe(10);
  });

  it("does not record tiles outside vision radius", () => {
    const grid = new Grid(20, 20);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const allAgents = new Map([["a1", agent]]);

    updateVision(agent, grid, allAgents, 10);

    const farTile = agent.getMemory(5 + DEFAULT_VISION_RADIUS + 1, 5);
    expect(farTile).toBeNull();
  });

  it("includes other agents in entity snapshots", () => {
    const grid = new Grid(20, 20);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const other = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "den-1", role: "beast", controller: "llm" });
    const allAgents = new Map([["a1", agent], ["a2", other]]);

    updateVision(agent, grid, allAgents, 10);

    const mem = agent.getMemory(6, 5);
    expect(mem!.entities).toHaveLength(1);
    expect(mem!.entities[0].id).toBe("a2");
  });
});

describe("mergeAdjacentMemories", () => {
  it("merges memories between adjacent agents of same faction", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "v1", role: "scout", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);
    b.recordTile(19, 19, "mountain", [], 8);

    mergeAdjacentMemories([a, b], grid);

    expect(a.getMemory(19, 19)).not.toBeNull();
    expect(b.getMemory(0, 0)).not.toBeNull();
  });

  it("does not merge between non-adjacent agents", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 8, y: 8 }, faction: "v1", role: "scout", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);
    b.recordTile(19, 19, "mountain", [], 8);

    mergeAdjacentMemories([a, b], grid);

    expect(a.getMemory(19, 19)).toBeNull();
    expect(b.getMemory(0, 0)).toBeNull();
  });

  it("does not merge between different factions", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);

    mergeAdjacentMemories([a, b], grid);

    expect(b.getMemory(0, 0)).toBeNull();
  });
});
