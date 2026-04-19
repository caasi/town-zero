import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { TriggerRegistry } from "../../src/dialogue/trigger-registry.js";
import { purgeProximityLedger } from "../../src/rooms/proximity-cleanup.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
    triggerRegistry: new TriggerRegistry(),
    activeSessions: new Map(),
    dialogueTrees: new Map(),
  };
}

describe("purgeProximityLedger", () => {
  it("removes the target player id from every NPC's ledger", () => {
    const state = buildState();

    const npc1 = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    const npc2 = new Agent({ id: "n2", position: { x: 1, y: 0 }, faction: "village", role: "villager", controller: "bot" });

    npc1.recordProximityTrigger("p1", 100);
    npc1.recordProximityTrigger("p2", 110);
    npc2.recordProximityTrigger("p1", 120);
    npc2.recordProximityTrigger("p2", 130);

    state.agents.set(npc1.id, npc1);
    state.agents.set(npc2.id, npc2);

    purgeProximityLedger(state, "p1");

    expect(npc1.getLastProximityTrigger("p1")).toBeUndefined();
    expect(npc2.getLastProximityTrigger("p1")).toBeUndefined();

    // Other players are untouched
    expect(npc1.getLastProximityTrigger("p2")).toBe(110);
    expect(npc2.getLastProximityTrigger("p2")).toBe(130);
  });

  it("is a no-op when no agent has the player id in its ledger", () => {
    const state = buildState();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    state.agents.set(npc.id, npc);

    expect(() => purgeProximityLedger(state, "ghost")).not.toThrow();
    expect(npc.getLastProximityTrigger("ghost")).toBeUndefined();
  });

  it("iterates all agents including merchants without affecting them", () => {
    const state = buildState();
    const merchant = new Agent({ id: "merchant-0", position: { x: 0, y: 4 }, faction: "merchant", role: "merchant", controller: "bot" });
    state.agents.set(merchant.id, merchant);

    expect(() => purgeProximityLedger(state, "p1")).not.toThrow();
  });
});
