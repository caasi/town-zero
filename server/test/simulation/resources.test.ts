import { describe, it, expect } from "vitest";
import { processGathering, processProduction, processConsumption } from "../../src/simulation/resources.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { GATHER_DURATION, FOOD_CONSUMPTION_INTERVAL, STARVATION_DAMAGE, PRODUCTION_INPUT_COST, PRODUCTION_OUTPUT, PRODUCTION_CYCLE_TICKS } from "@town-zero/shared";

describe("processGathering", () => {
  it("increments gather progress each tick", () => {
    const grid = new Grid(10, 10);
    grid.setResourceYield(3, 3, "food");
    const agent = new Agent({ id: "a1", position: { x: 3, y: 3 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.state = "gathering";
    agent.currentCommandTicks = 0;
    agent.currentCommandTarget = GATHER_DURATION;

    processGathering(agent, grid);
    expect(agent.currentCommandTicks).toBe(1);
    expect(agent.state).toBe("gathering");
  });

  it("completes gathering and adds resource to inventory", () => {
    const grid = new Grid(10, 10);
    grid.setResourceYield(3, 3, "food");
    const agent = new Agent({ id: "a1", position: { x: 3, y: 3 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.state = "gathering";
    agent.currentCommandTicks = GATHER_DURATION - 1;
    agent.currentCommandTarget = GATHER_DURATION;

    processGathering(agent, grid);
    expect(agent.inventory.food).toBe(1);
    expect(agent.state).toBe("idle");
  });
});

describe("processProduction", () => {
  it("produces output when operator present and materials available", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: "a1" });
    settlement.addResource("material", PRODUCTION_INPUT_COST);

    const agents = new Map([["a1", new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" })]]);
    // Operator just needs to be alive — no special "operating" state required

    processProduction(settlement, agents, PRODUCTION_CYCLE_TICKS); // tick == cycle boundary
    expect(settlement.inventory.food).toBe(PRODUCTION_OUTPUT);
    expect(settlement.inventory.material).toBe(0);
  });

  it("does not produce without operator", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: null });
    settlement.addResource("material", 10);

    processProduction(settlement, new Map(), PRODUCTION_CYCLE_TICKS);
    expect(settlement.inventory.food).toBe(0);
  });

  it("does not produce without materials", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: "a1" });

    const agents = new Map([["a1", new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" })]]);
    agents.get("a1")!.state = "operating";

    processProduction(settlement, agents, PRODUCTION_CYCLE_TICKS);
    expect(settlement.inventory.food).toBe(0);
  });
});

describe("processConsumption", () => {
  it("consumes food from agent inventory at interval", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 5);

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL); // tick == consumption boundary
    expect(agent.inventory.food).toBe(4);
    expect(agent.hp).toBe(100);
  });

  it("does not consume on non-interval ticks", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 5);

    processConsumption(agent, 1); // not on interval
    expect(agent.inventory.food).toBe(5);
  });

  it("damages agent when starving", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    // no food in inventory

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL);
    expect(agent.hp).toBe(100 - STARVATION_DAMAGE);
  });

  it("NPC starvation floors at 1 HP (cannot die from hunger)", () => {
    const agent = new Agent({ id: "npc-1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.hp = STARVATION_DAMAGE; // exactly one hit from death

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL);
    expect(agent.hp).toBe(1);
    expect(agent.isAlive()).toBe(true);
  });

  it("NPC already at 1 HP stays at 1 HP when starving", () => {
    const agent = new Agent({ id: "npc-1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "bot" });
    agent.hp = 1;

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL);
    expect(agent.hp).toBe(1);
    expect(agent.isAlive()).toBe(true);
  });

  it("player CAN die from starvation", () => {
    const agent = new Agent({ id: "player-0", position: { x: 0, y: 0 }, faction: "v1", role: "player", controller: "player" });
    agent.hp = STARVATION_DAMAGE;

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL);
    expect(agent.hp).toBe(0);
    expect(agent.isAlive()).toBe(false);
  });
});
