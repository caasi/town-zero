import { describe, it, expect } from "vitest";
import type { SimulationState } from "../../src/simulation/tick.js";
import { processTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { FOOD_CONSUMPTION_INTERVAL, BASE_ATTACK_DAMAGE } from "@town-zero/shared";

function makeWorld(): SimulationState {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  grid.setOwner(5, 5, "v1");
  grid.setOwner(5, 6, "v1");

  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addStructure({ id: "h1", type: "housing", position: { x: 5, y: 5 }, operatorId: null });

  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
  agent.addToInventory("food", 10);
  settlement.populationIds.push("a1");

  return {
    grid,
    agents: new Map([["a1", agent]]),
    settlements: new Map([["v1", settlement]]),
    tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("processTick", () => {
  it("increments tick counter", () => {
    const world = makeWorld();
    processTick(world);
    expect(world.tick).toBe(1);
  });

  describe("Phase 1: InputFrame consumption", () => {
    it("consumes one InputFrame per tick from inputQueue", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "south" });
      agent.enqueueInput({ seq: 2, direction: "south" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 6 });
      expect(agent.lastProcessedInput).toBe(1);
      expect(agent.inputQueue).toHaveLength(1);
    });

    it("falls back to planBacklog when inputQueue is empty", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.planBacklog = [{ seq: 0, action: { type: "idle" } }];
      processTick(world);
      expect(agent.planBacklog).toHaveLength(0);
      expect(agent.lastProcessedInput).toBe(0); // seq=0 doesn't update
    });

    it("instant gather via InputFrame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.position = { x: 3, y: 2 };
      agent.enqueueInput({ seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } });
      processTick(world);
      expect(agent.inventory.food).toBe(11); // 10 initial + 1 gathered
      expect(agent.state).toBe("idle"); // no FSM change
    });

    it("instant attack via InputFrame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
      target.addToInventory("food", 10);
      world.agents.set("enemy", target);
      agent.enqueueInput({ seq: 1, action: { type: "attack", targetId: "enemy" } });
      processTick(world);
      expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
      expect(agent.state).toBe("idle");
    });

    it("action takes priority over direction in same frame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.position = { x: 3, y: 2 };
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "east", action: { type: "gather", resourceTile: { x: 3, y: 3 } } });
      processTick(world);
      expect(agent.inventory.food).toBe(11);
      expect(agent.facing).toBe("south"); // direction ignored
    });

    it("skips dead agents", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.hp = 0;
      agent.state = "dead";
      agent.inputQueue.push({ seq: 1, direction: "south" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 5 }); // didn't move
    });

    it("turn-before-move via InputFrame direction", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "east" });
      processTick(world);
      expect(agent.facing).toBe("east");
      expect(agent.position).toEqual({ x: 5, y: 5 }); // turned only
      expect(agent.lastProcessedInput).toBe(1);
    });
  });

  it("processes food consumption and starvation", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.inventory.food = 0;
    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL; i++) {
      processTick(world);
    }
    expect(agent.hp).toBeLessThan(100);
  });
});
