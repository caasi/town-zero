import { describe, it, expect } from "vitest";
import { updateVision, mergeAdjacentMemories, updateStoreKnowledge, storeFoodKey } from "../../src/simulation/vision.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { Grid } from "../../src/simulation/grid.js";
import { DEFAULT_VISION_RADIUS, RESOURCE_MAX_AMOUNT } from "@town-zero/shared";

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

  it("records how much a resource tile holds when seen", () => {
    const grid = new Grid(20, 20);
    grid.setResourceYield(6, 5, "food");
    grid.takeResource(6, 5);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    updateVision(agent, grid, new Map([["a1", agent]]), 10);
    grid.takeResource(6, 5); // later changes are not in the memory
    expect(agent.getMemory(6, 5)!.resourceAmount).toBe(RESOURCE_MAX_AMOUNT - 1);
    expect(agent.getMemory(5, 5)!.resourceAmount).toBe(0);
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

  it("records what the observer saw of another agent: role and HP", () => {
    const grid = new Grid(20, 20);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const other = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "den-1", role: "beast", controller: "llm" });
    other.hp = 40;
    updateVision(agent, grid, new Map([["a1", agent], ["a2", other]]), 10);

    other.hp = 100; // later changes are not in the memory
    expect(agent.getMemory(6, 5)!.entities[0]).toMatchObject({ role: "beast", hp: 40, maxHp: 100 });
  });

  it("derives entity snapshot type from faction", () => {
    const grid = new Grid(20, 20);
    const observer = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const monster = new Agent({ id: "b1", position: { x: 4, y: 5 }, faction: "den-1", role: "beast", controller: "bot" });
    const ally = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "v1", role: "scout", controller: "llm" });
    const allAgents = new Map([["a1", observer], ["b1", monster], ["a2", ally]]);

    updateVision(observer, grid, allAgents, 10);

    expect(observer.getMemory(4, 5)!.entities[0].type).toBe("monster");
    expect(observer.getMemory(5, 6)!.entities[0].type).toBe("agent");
  });
});

describe("updateStoreKnowledge", () => {
  function setup() {
    const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 2, y: 2 }] });
    den.addResource("food", 7);
    const beast = new Agent({ id: "b1", position: { x: 2, y: 2 }, faction: "den-1", role: "beast", controller: "llm" });
    return { den, beast, settlements: new Map([["den-1", den]]) };
  }

  it("an agent inside a settlement learns how much food it holds", () => {
    const { beast, settlements } = setup();
    updateStoreKnowledge(beast, settlements, 10);
    expect(beast.getBelief(storeFoodKey("den-1"))).toMatchObject({ value: 7, tick: 10, source: "b1" });
  });

  it("an agent away from the settlement keeps the count of its last visit", () => {
    const { den, beast, settlements } = setup();
    updateStoreKnowledge(beast, settlements, 10);
    beast.position = { x: 9, y: 9 };
    den.inventory.food = 0;
    updateStoreKnowledge(beast, settlements, 20);
    expect(beast.getBelief(storeFoodKey("den-1"))?.value).toBe(7);
  });

  it("a dead agent learns nothing", () => {
    const { beast, settlements } = setup();
    beast.takeDamage(beast.hp);
    updateStoreKnowledge(beast, settlements, 10);
    expect(beast.getBelief(storeFoodKey("den-1"))).toBeUndefined();
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
