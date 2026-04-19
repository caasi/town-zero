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

describe("Agent.proximityBubble", () => {
  it("exposes a typed proximityBubble config field (optional)", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    expect(a.proximityBubble).toBeUndefined();
  });

  it("tracks last trigger tick per player in the proximity ledger", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    expect(a.getLastProximityTrigger("p1")).toBe(100);
    expect(a.getLastProximityTrigger("p2")).toBeUndefined();
  });

  it("removes a player from the ledger on disconnect-cleanup", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    a.forgetPlayerProximity("p1");
    expect(a.getLastProximityTrigger("p1")).toBeUndefined();
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

  it("fires proximityBubble when a player enters the NPC's vision radius", () => {
    const world = makeBubbleWorld();
    const npc = new Agent({
      id: "n1",
      position: { x: 5, y: 5 },
      faction: "f",
      role: "villager",
      controller: "bot",
      proximityBubble: { text: "Hi!", durationTicks: 5, cooldownTicks: 50 },
    });
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);

    expect(npc.bubbleText).toBe("Hi!");
    expect(npc.getLastProximityTrigger("p1")).toBe(world.tick);
  });

  it("does not re-fire within cooldownTicks", () => {
    const world = makeBubbleWorld();
    const npc = new Agent({
      id: "n1",
      position: { x: 5, y: 5 },
      faction: "f",
      role: "villager",
      controller: "bot",
      proximityBubble: { text: "Hi!", durationTicks: 2, cooldownTicks: 50 },
    });
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world); // fires at tick 1
    const firstFireTick = npc.getLastProximityTrigger("p1");
    expect(firstFireTick).toBe(1);

    // Advance several ticks but stay below cooldown; bubble will expire mid-way
    for (let i = 0; i < 5; i++) processTick(world);
    expect(npc.bubbleText).toBeNull(); // expired
    expect(npc.getLastProximityTrigger("p1")).toBe(firstFireTick); // ledger unchanged → no re-fire
  });

  it("re-fires after cooldown once conditions allow", () => {
    const world = makeBubbleWorld();
    const npc = new Agent({
      id: "n1",
      position: { x: 5, y: 5 },
      faction: "f",
      role: "villager",
      controller: "bot",
      proximityBubble: { text: "Hi!", durationTicks: 2, cooldownTicks: 5 },
    });
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world); // fires at tick 1
    expect(npc.getLastProximityTrigger("p1")).toBe(1);

    // Advance past cooldown
    for (let i = 0; i < 6; i++) processTick(world);

    expect(npc.getLastProximityTrigger("p1")).toBeGreaterThan(1);
    expect(npc.bubbleText).toBe("Hi!");
  });

  it("does not extend bubble duration when a second player arrives mid-bubble", () => {
    // First player triggers the bubble; second player arrives while the
    // bubble is still displayed. Expected: bubbleExpiresAt stays pinned to
    // the original expiry (no re-trigger extension), but the second player
    // still lands in the ledger so their personal cooldown starts.
    const world = makeBubbleWorld();
    const npc = new Agent({
      id: "n1",
      position: { x: 5, y: 5 },
      faction: "f",
      role: "villager",
      controller: "bot",
      proximityBubble: { text: "Hi!", durationTicks: 10, cooldownTicks: 50 },
    });
    const p1 = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(p1.id, p1);

    processTick(world); // tick → 1, bubble fires for p1
    expect(npc.bubbleText).toBe("Hi!");
    const originalExpiry = npc.bubbleExpiresAt;
    expect(originalExpiry).toBeGreaterThan(0);

    // Second player arrives next tick, bubble still active
    const p2 = new Agent({ id: "p2", position: { x: 4, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(p2.id, p2);

    processTick(world); // tick → 2
    // Expiry MUST NOT have shifted — duration extension would be a bug.
    expect(npc.bubbleExpiresAt).toBe(originalExpiry);
    // p2 is recorded so its own cooldown is honored on future re-entries.
    expect(npc.getLastProximityTrigger("p2")).toBeDefined();
  });

  it("does not fire proximity bubble for a dead NPC", () => {
    const world = makeBubbleWorld();
    const npc = new Agent({
      id: "n1",
      position: { x: 5, y: 5 },
      faction: "f",
      role: "villager",
      controller: "bot",
      proximityBubble: { text: "Hi!", durationTicks: 5, cooldownTicks: 50 },
    });
    npc.takeDamage(npc.hp);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);

    expect(npc.bubbleText).toBeNull();
    expect(npc.getLastProximityTrigger("p1")).toBeUndefined();
  });
});
