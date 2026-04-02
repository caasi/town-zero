import "../../src/polyfill.js";
import { describe, it, expect } from "vitest";
import { syncToSchema, syncTiles } from "../../src/rooms/sync.js";
import { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function makeSimState(overrides?: Partial<SimulationState>): SimulationState {
  return {
    grid: new Grid(10, 10),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
    ...overrides,
  };
}

function makeAgent(id: string, x = 5, y = 5): Agent {
  return new Agent({ id, position: { x, y }, faction: "village-1", role: "farmer", controller: "bot" });
}

describe("syncToSchema", () => {
  it("syncs tick counter", () => {
    const sim = makeSimState({ tick: 42 });
    const state = new WorldStateSchema();
    syncToSchema(sim, state);
    expect(state.tick).toBe(42);
  });

  it("syncs agents into schema", () => {
    const agent = makeAgent("a1", 3, 7);
    agent.addToInventory("food", 5);
    agent.addToInventory("material", 2);
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });

    const state = new WorldStateSchema();
    syncToSchema(sim, state);

    const schema = state.agents.get("a1");
    expect(schema).toBeDefined();
    expect(schema!.id).toBe("a1");
    expect(schema!.x).toBe(3);
    expect(schema!.y).toBe(7);
    expect(schema!.hp).toBe(100);
    expect(schema!.state).toBe("idle");
    expect(schema!.faction).toBe("village-1");
    expect(schema!.role).toBe("farmer");
    expect(schema!.controller).toBe("bot");
    expect(schema!.currentTargetId).toBe("");
    expect(schema!.inventory.get("food")).toBe(5);
    expect(schema!.inventory.get("material")).toBe(2);
    expect(schema!.inventory.get("currency")).toBe(0);
  });

  it("updates existing agent schema on subsequent sync", () => {
    const agent = makeAgent("a1", 3, 7);
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.x).toBe(3);

    agent.position = { x: 4, y: 7 };
    sim.tick = 1;
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.x).toBe(4);
    expect(state.tick).toBe(1);
  });

  it("removes agent schema when agent is removed from sim (merchant despawn)", () => {
    const agent = makeAgent("m1");
    const sim = makeSimState({ agents: new Map([["m1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.has("m1")).toBe(true);

    sim.agents.delete("m1");
    syncToSchema(sim, state);
    expect(state.agents.has("m1")).toBe(false);
  });

  it("keeps dead agents in schema with state dead", () => {
    const agent = makeAgent("a1");
    agent.takeDamage(200);
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("dead");
    expect(state.agents.get("a1")!.hp).toBe(0);
  });

  it("syncs settlements with derived fields", () => {
    const village = new Settlement({
      id: "v1",
      faction: "village-1",
      type: "village",
      territory: [{ x: 10, y: 20 }, { x: 11, y: 20 }],
    });
    village.addStructure({ id: "h1", type: "housing", position: { x: 10, y: 20 }, operatorId: null });
    village.addStructure({ id: "p1", type: "production", position: { x: 11, y: 20 }, operatorId: "a1" });
    village.populationIds.push("a1", "a2", "a3");
    village.addResource("food", 30);

    const sim = makeSimState({ settlements: new Map([["v1", village]]) });
    const state = new WorldStateSchema();
    syncToSchema(sim, state);

    const schema = state.settlements.get("v1");
    expect(schema).toBeDefined();
    expect(schema!.id).toBe("v1");
    expect(schema!.faction).toBe("village-1");
    expect(schema!.type).toBe("village");
    expect(schema!.x).toBe(10);
    expect(schema!.y).toBe(20);
    expect(schema!.population).toBe(3);
    expect(schema!.maxPopulation).toBe(4); // 1 housing × HOUSING_POPULATION_CAP(4)
    expect(schema!.inventory.get("food")).toBe(30);
    expect(schema!.structures.length).toBe(2);
    expect(schema!.structures.at(0)!.id).toBe("h1");
    expect(schema!.structures.at(1)!.operatorId).toBe("a1");
  });

  it("syncs agent state transitions", () => {
    const agent = makeAgent("a1");
    agent.state = "gathering";
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("gathering");

    agent.state = "idle";
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("idle");
  });

  it("syncs agent inventory changes", () => {
    const agent = makeAgent("a1");
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.inventory.get("food")).toBe(0);

    agent.addToInventory("food", 10);
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.inventory.get("food")).toBe(10);
  });
});

describe("syncTiles", () => {
  it("populates tile schemas from grid", () => {
    const grid = new Grid(3, 3);
    grid.setTerrain(1, 1, "forest");
    grid.setResourceYield(0, 0, "food");
    grid.setOwner(2, 2, "village-1");

    const state = new WorldStateSchema();
    syncTiles(grid, state);

    expect(state.tiles.size).toBe(9); // 3x3
    expect(state.tiles.get("1,1")!.terrain).toBe("forest");
    expect(state.tiles.get("0,0")!.resourceYield).toBe("food");
    expect(state.tiles.get("2,2")!.ownerFaction).toBe("village-1");
    expect(state.tiles.get("0,1")!.terrain).toBe("plains");
    expect(state.tiles.get("0,1")!.resourceYield).toBe("");
    expect(state.tiles.get("0,1")!.ownerFaction).toBe("");
  });
});
