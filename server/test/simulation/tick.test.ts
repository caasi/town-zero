import { describe, it, expect } from "vitest";
import { SimulationState, processTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { FOOD_CONSUMPTION_INTERVAL, GATHER_DURATION, ATTACK_COOLDOWN_TICKS, BASE_ATTACK_DAMAGE } from "@town-zero/shared";

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
    nextMerchantId: 0,
  };
}

describe("processTick", () => {
  it("increments tick counter", () => {
    const world = makeWorld();
    processTick(world);
    expect(world.tick).toBe(1);
  });

  it("executes agent move command from plan", () => {
    const world = makeWorld();
    world.agents.get("a1")!.setPlan([{ type: "move", target: { x: 6, y: 5 } }]);
    processTick(world);
    expect(world.agents.get("a1")!.position).toEqual({ x: 6, y: 5 });
  });

  it("starts gathering when gather command issued", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 3 };
    agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);
    processTick(world);
    expect(agent.state).toBe("gathering");
  });

  it("completes gathering after enough ticks", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 3 };
    agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);

    for (let i = 0; i < GATHER_DURATION + 1; i++) {
      processTick(world);
    }
    expect(agent.inventory.food).toBe(11); // 10 initial + 1 gathered
    expect(agent.state).toBe("idle");
  });

  it("processes food consumption and starvation", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.inventory.food = 0; // starving

    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL; i++) {
      processTick(world);
    }
    expect(agent.hp).toBeLessThan(100);
  });

  it("removes dead agents from settlements", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.hp = 1;
    agent.inventory.food = 0;

    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL * 20; i++) {
      processTick(world);
      if (!agent.isAlive()) break;
    }
    expect(agent.isAlive()).toBe(false);
  });

  it("completes combat after ATTACK_COOLDOWN_TICKS", () => {
    const world = makeWorld();
    const attacker = world.agents.get("a1")!;
    attacker.addToInventory("food", 100);
    const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
    target.addToInventory("food", 100);
    world.agents.set("enemy", target);

    attacker.setPlan([{ type: "attack", targetId: "enemy" }]);
    // Dispatch tick: attack command dequeued, first processCombat call
    processTick(world);
    expect(attacker.state).toBe("fighting");

    // Run remaining cooldown ticks
    for (let i = 1; i < ATTACK_COOLDOWN_TICKS; i++) {
      processTick(world);
    }
    expect(attacker.state).toBe("idle");
    expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE * ATTACK_COOLDOWN_TICKS);
  });

  it("returns attacker to idle when target dies mid-combat", () => {
    const world = makeWorld();
    const attacker = world.agents.get("a1")!;
    attacker.addToInventory("food", 100);
    const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot", hp: 1 });
    target.addToInventory("food", 100);
    world.agents.set("enemy", target);

    attacker.setPlan([{ type: "attack", targetId: "enemy" }]);
    processTick(world); // dispatch + first combat → target dies
    expect(target.isAlive()).toBe(false);

    processTick(world); // attacker should recover to idle, not stay stuck
    expect(attacker.state).toBe("idle");
  });
});
