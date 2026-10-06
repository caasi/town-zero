import { describe, it, expect } from "vitest";
import { processConsumption } from "../../src/simulation/resources.js";
import { Agent } from "../../src/simulation/agent.js";
import { FOOD_CONSUMPTION_INTERVAL, STARVATION_DAMAGE } from "@town-zero/shared";

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
