import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { TriggerRegistry } from "../../src/dialogue/trigger-registry.js";
import { purgeProximityState } from "../../src/rooms/proximity-state-cleanup.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, triggerRegistry: new TriggerRegistry(),
    activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("purgeProximityState", () => {
  it("removes the target player id from every alive NPC's proximityState", () => {
    const state = buildState();
    const n1 = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    const n2 = new Agent({ id: "n2", position: { x: 1, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    n1.proximityState.set("p1", 3);
    n1.proximityState.set("p2", 5);
    n2.proximityState.set("p1", 2);
    state.agents.set("n1", n1); state.agents.set("n2", n2);

    purgeProximityState(state, "p1");

    expect(n1.proximityState.has("p1")).toBe(false);
    expect(n2.proximityState.has("p1")).toBe(false);
    expect(n1.proximityState.get("p2")).toBe(5);
  });
});
