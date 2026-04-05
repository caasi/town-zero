import { describe, it, expect } from "vitest";
import type { SimulationState } from "../../src/simulation/tick.js";
import { processTick } from "../../src/simulation/tick.js";
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
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
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
    // Agent default facing is south, so move south to actually move (not just turn)
    world.agents.get("a1")!.setPlan([{ type: "move", target: { x: 5, y: 6 } }]);
    processTick(world);
    expect(world.agents.get("a1")!.position).toEqual({ x: 5, y: 6 });
  });

  it("starts gathering when gather command issued from adjacent tile", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 2 };
    agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);
    processTick(world);
    expect(agent.state).toBe("gathering");
  });

  it("completes gathering after enough ticks", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 2 };
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

  it("kills player agents that starve to death", () => {
    const world = makeWorld();
    const player = new Agent({ id: "p1", position: { x: 5, y: 6 }, faction: "v1", role: "player", controller: "player" });
    player.hp = 1;
    world.agents.set("p1", player);

    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL * 20; i++) {
      processTick(world);
      if (!player.isAlive()) break;
    }
    expect(player.isAlive()).toBe(false);
  });

  it("completes combat after ATTACK_COOLDOWN_TICKS", () => {
    const world = makeWorld();
    const attacker = world.agents.get("a1")!;
    attacker.addToInventory("food", 100);
    const targetHp = BASE_ATTACK_DAMAGE * ATTACK_COOLDOWN_TICKS + 100;
    const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot", hp: targetHp });
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
    expect(target.hp).toBe(100); // targetHp - ATTACK_COOLDOWN_TICKS * BASE_ATTACK_DAMAGE
  });

  describe("Phase 1.5: moveQueue", () => {
    it("consumes one move input per tick and advances lastProcessedInput", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueMoveInput({ seq: 1, direction: "south" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 6 });
      expect(agent.lastProcessedInput).toBe(1);
    });

    it("advances lastProcessedInput even when move is rejected (wall)", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      world.grid.setTerrain(5, 4, "water");
      agent.facing = "north";
      agent.enqueueMoveInput({ seq: 1, direction: "north" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 5 }); // didn't move
      expect(agent.lastProcessedInput).toBe(1);         // but seq advanced
    });

    it("processes turn-before-move and advances lastProcessedInput", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueMoveInput({ seq: 1, direction: "east" });
      processTick(world);
      expect(agent.facing).toBe("east");
      expect(agent.position).toEqual({ x: 5, y: 5 }); // turned only
      expect(agent.lastProcessedInput).toBe(1);
    });

    it("does not consume moveQueue when agent is not idle", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.state = "gathering";
      agent.enqueueMoveInput({ seq: 1, direction: "south" });
      processTick(world);
      expect(agent.moveQueue).toHaveLength(1); // not consumed
      expect(agent.lastProcessedInput).toBe(0);
    });

    it("yields to plan commands — gather executes despite queued moves", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.position = { x: 3, y: 2 }; // adjacent to resource at (3,3)
      agent.enqueueMoveInput({ seq: 1, direction: "south" });
      agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);
      processTick(world);
      expect(agent.state).toBe("gathering"); // plan command executed, not move
      expect(agent.moveQueue).toHaveLength(0); // cleared
    });

    it("never decreases lastProcessedInput (monotonic)", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.lastProcessedInput = 10;
      agent.enqueueMoveInput({ seq: 5, direction: "south" }); // stale seq
      processTick(world);
      expect(agent.lastProcessedInput).toBe(10); // not decreased
    });

    it("consumes one per tick, leaving rest in queue", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueMoveInput({ seq: 1, direction: "south" });
      agent.enqueueMoveInput({ seq: 2, direction: "south" });
      processTick(world);
      expect(agent.moveQueue).toHaveLength(1);
      expect(agent.moveQueue[0].seq).toBe(2);
      expect(agent.lastProcessedInput).toBe(1);
    });
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
