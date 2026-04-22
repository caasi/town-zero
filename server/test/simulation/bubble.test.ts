import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { processTick, type SimulationState } from "../../src/simulation/tick.js";

describe("Agent.setBubble", () => {
  it("sets bubbleText and computes bubbleExpiresAt from current tick", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("早安", 80, /*currentTick*/ 100);
    expect(a.bubbleText).toBe("早安");
    expect(a.bubbleExpiresAt).toBe(180);
  });

  it("clears immediately when text is empty or duration is zero", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("hi", 10, 0);
    a.setBubble("", 0, 5);
    expect(a.bubbleText).toBeNull();
    expect(a.bubbleExpiresAt).toBe(0);
  });

  it("truncates overlong text to the schema cap", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const long = "x".repeat(200);
    a.setBubble(long, 10, 0);
    expect(a.bubbleText!.length).toBeLessThanOrEqual(64);
  });
});

function makeBubbleWorld(): SimulationState {
  return {
    grid: new Grid(20, 20),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map(),
  };
}

describe("processTick — bubble upkeep", () => {
  it("clears bubble when bubbleExpiresAt is reached", () => {
    const world = makeBubbleWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    npc.setBubble("hi", 2, 0); // bubbleExpiresAt = 2
    world.agents.set(npc.id, npc);

    processTick(world); // tick → 1, still active
    expect(npc.bubbleText).toBe("hi");

    processTick(world); // tick → 2, expiry fires
    expect(npc.bubbleText).toBeNull();
    expect(npc.bubbleExpiresAt).toBe(0);
  });

  it("clears an active bubble when the NPC dies before expiry", () => {
    // If a bubble is active at the tick an NPC dies, the expiry check must
    // still run on subsequent ticks — otherwise `bubbleText` keeps syncing
    // to clients forever on a corpse.
    const world = makeBubbleWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    npc.setBubble("hi", 5, 0); // bubbleExpiresAt = 5
    world.agents.set(npc.id, npc);

    processTick(world); // tick → 1
    expect(npc.bubbleText).toBe("hi");

    npc.takeDamage(npc.hp);
    expect(npc.isAlive()).toBe(false);
    expect(npc.bubbleText).toBe("hi"); // death alone doesn't clear bubble

    // Advance past the original expiry.
    for (let i = 0; i < 5; i++) processTick(world);

    expect(npc.bubbleText).toBeNull();
    expect(npc.bubbleExpiresAt).toBe(0);
  });
});
