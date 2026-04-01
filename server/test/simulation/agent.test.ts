import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";

describe("Agent", () => {
  function makeAgent(overrides?: Partial<ConstructorParameters<typeof Agent>[0]>) {
    return new Agent({
      id: "agent-1",
      position: { x: 5, y: 5 },
      faction: "village-1",
      role: "farmer",
      controller: "llm",
      ...overrides,
    });
  }

  it("creates agent with default values", () => {
    const agent = makeAgent();
    expect(agent.id).toBe("agent-1");
    expect(agent.hp).toBe(100);
    expect(agent.maxHp).toBe(100);
    expect(agent.state).toBe("idle");
    expect(agent.inventory).toEqual({ food: 0, material: 0, currency: 0 });
    expect(agent.plan).toEqual([]);
  });

  it("sets maxHp to DEFAULT_MAX_HP even when constructed with lower hp", () => {
    const agent = makeAgent({ hp: 50 });
    expect(agent.hp).toBe(50);
    expect(agent.maxHp).toBe(100);
  });

  it("adds resources to inventory", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 5);
    expect(agent.inventory.food).toBe(5);
  });

  it("removes resources from inventory", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 5);
    expect(agent.removeFromInventory("food", 3)).toBe(true);
    expect(agent.inventory.food).toBe(2);
  });

  it("refuses to remove more than available", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 2);
    expect(agent.removeFromInventory("food", 5)).toBe(false);
    expect(agent.inventory.food).toBe(2);
  });

  it("checks resource availability", () => {
    const agent = makeAgent();
    agent.addToInventory("material", 3);
    expect(agent.hasResource("material", 3)).toBe(true);
    expect(agent.hasResource("material", 4)).toBe(false);
  });

  it("takes damage and dies", () => {
    const agent = makeAgent();
    agent.takeDamage(80);
    expect(agent.hp).toBe(20);
    expect(agent.isAlive()).toBe(true);
    agent.takeDamage(30);
    expect(agent.hp).toBe(0);
    expect(agent.isAlive()).toBe(false);
    expect(agent.state).toBe("dead");
  });

  it("sets and clears plan", () => {
    const agent = makeAgent();
    agent.setPlan([{ type: "move", target: { x: 6, y: 5 } }, { type: "idle" }]);
    expect(agent.plan).toHaveLength(2);
    agent.clearPlan();
    expect(agent.plan).toHaveLength(0);
  });

  it("shifts next command from plan", () => {
    const agent = makeAgent();
    agent.setPlan([{ type: "move", target: { x: 6, y: 5 } }, { type: "idle" }]);
    const cmd = agent.shiftPlan();
    expect(cmd?.type).toBe("move");
    expect(agent.plan).toHaveLength(1);
  });

  it("returns undefined when plan is empty", () => {
    const agent = makeAgent();
    expect(agent.shiftPlan()).toBeUndefined();
  });

  it("records tile in map memory", () => {
    const agent = makeAgent();
    agent.recordTile(3, 4, "forest", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 3, y: 4 } }], 10);
    const mem = agent.getMemory(3, 4);
    expect(mem).not.toBeNull();
    expect(mem!.terrain).toBe("forest");
    expect(mem!.entities).toHaveLength(1);
    expect(mem!.timestamp).toBe(10);
  });

  it("returns null for unvisited tile", () => {
    const agent = makeAgent();
    expect(agent.getMemory(0, 0)).toBeNull();
  });
});
