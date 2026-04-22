import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import type { NpcEventName, EventHandler } from "@town-zero/shared/script-dsl";

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
    expect(agent.inputQueue).toEqual([]);
    expect(agent.planBacklog).toEqual([]);
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

  describe("inputQueue", () => {
    it("initialises with empty inputQueue, planBacklog, and lastProcessedInput 0", () => {
      const agent = makeAgent();
      expect(agent.inputQueue).toEqual([]);
      expect(agent.planBacklog).toEqual([]);
      expect(agent.lastProcessedInput).toBe(0);
    });

    it("caps inputQueue at INPUT_QUEUE_CAP, dropping oldest", () => {
      const agent = makeAgent();
      agent.enqueueInput({ seq: 1, direction: "north" });
      agent.enqueueInput({ seq: 2, direction: "east" });
      agent.enqueueInput({ seq: 3, direction: "south" });
      agent.enqueueInput({ seq: 4, direction: "west" }); // overflow
      expect(agent.inputQueue).toHaveLength(3);
      expect(agent.inputQueue[0].seq).toBe(2); // oldest (seq=1) dropped
    });

    it("player frame (seq > 0) flushes seq=0 frames and clears planBacklog", () => {
      const agent = makeAgent();
      agent.planBacklog = [{ seq: 0, action: { type: "idle" } }];
      agent.inputQueue.push({ seq: 0, action: { type: "idle" } });
      agent.enqueueInput({ seq: 1, direction: "south" });
      expect(agent.inputQueue).toEqual([{ seq: 1, direction: "south" }]);
      expect(agent.planBacklog).toEqual([]);
    });

    it("rejects player frame with seq <= lastProcessedInput (stale)", () => {
      const agent = makeAgent();
      agent.lastProcessedInput = 5;
      agent.enqueueInput({ seq: 5, direction: "north" });
      expect(agent.inputQueue).toEqual([]);
      agent.enqueueInput({ seq: 3, direction: "north" });
      expect(agent.inputQueue).toEqual([]);
    });

    it("rejects duplicate seq (seq <= last queued seq)", () => {
      const agent = makeAgent();
      agent.enqueueInput({ seq: 1, direction: "north" });
      agent.enqueueInput({ seq: 1, direction: "east" }); // duplicate
      expect(agent.inputQueue).toHaveLength(1);
      expect(agent.inputQueue[0].direction).toBe("north");
    });

    it("accepts bot frame (seq=0) regardless of lastProcessedInput", () => {
      const agent = makeAgent();
      agent.lastProcessedInput = 100;
      agent.enqueueInput({ seq: 0, action: { type: "idle" } });
      expect(agent.inputQueue).toHaveLength(1);
    });
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

  it("initializes with facing south by default", () => {
    const agent = makeAgent();
    expect(agent.facing).toBe("south");
  });

  it("accepts custom facing in constructor", () => {
    const agent = makeAgent({ facing: "north" });
    expect(agent.facing).toBe("north");
  });

});

describe("Agent.eventHandlers + proximityState", () => {
  it("exposes empty eventHandlers and proximityState maps", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    expect(a.eventHandlers.size).toBe(0);
    expect(a.proximityState.size).toBe(0);
  });

  it("accepts handler registration under a known event key", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const h: EventHandler<unknown> = () => [];
    const key: NpcEventName = "proximity:enter";
    a.eventHandlers.set(key, [h]);
    expect(a.eventHandlers.get(key)).toEqual([h]);
  });
});
