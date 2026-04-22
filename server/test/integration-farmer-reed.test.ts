import { describe, it, expect, beforeEach } from "vitest";
import { DIALOGUE_TIMEOUT_TICKS } from "@town-zero/shared";
import { farmerReedScenario } from "../src/scenarios/farmer-reed.js";
import { loadScenario } from "../src/simulation/scenario-loader.js";
import { Grid } from "../src/simulation/grid.js";
import { Agent } from "../src/simulation/agent.js";
import {
  startDialogue, advanceDialogue, chooseDialogue,
  endDialogue, tickDialogues,
} from "../src/dialogue/session-manager.js";
import type { SimulationState } from "../src/simulation/tick.js";

function makeState(): SimulationState {
  const grid = new Grid(10, 10);
  const agents = new Map<string, Agent>();
  const state: SimulationState = {
    grid,
    agents,
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map(),
  };

  const { triggerRegistry, dialogueTrees } = loadScenario(farmerReedScenario, state);
  state.triggerRegistry = triggerRegistry;
  state.dialogueTrees = dialogueTrees;

  return state;
}

function addPlayer(state: SimulationState, id: string, x: number, y: number): Agent {
  const player = new Agent({
    id,
    position: { x, y },
    faction: "village-1",
    role: "player",
    controller: "player",
  });
  state.agents.set(id, player);
  return player;
}

describe("integration: Farmer Reed full flow", () => {
  let state: SimulationState;
  let reed: Agent;

  beforeEach(() => {
    state = makeState();
    reed = state.agents.get("farmer-reed")!;
  });

  it("happy path: accept quest → gather → return → hand over", () => {
    const player = addPlayer(state, "player-0", reed.position.x, reed.position.y - 1);
    player.addToInventory("food", 10);

    // Start dialogue
    const r1 = startDialogue("player-0", "farmer-reed", state);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.payload.nodeType).toBe("text");
    expect(player.facing).toBe("south"); // auto-faced toward Reed

    // Advance to choice
    const r2 = advanceDialogue("player-0", state);
    expect(r2.ok && r2.payload.nodeType).toBe("choice");
    if (!r2.ok) return;

    // Accept quest
    const acceptOpt = r2.payload.options!.find((o) => o.label.includes("help"));
    const r3 = chooseDialogue("player-0", acceptOpt!.id, state);
    expect(r3.ok).toBe(true);
    expect(reed.getBelief("food_quest_active")?.value).toBe(true);

    // Advance past accept-text → done (auto-end)
    advanceDialogue("player-0", state);
    expect(state.activeSessions.has("farmer-reed")).toBe(false);

    // Return: entry point routes to check-return
    const r5 = startDialogue("player-0", "farmer-reed", state);
    expect(r5.ok).toBe(true);
    if (!r5.ok) return;
    expect(r5.payload.content).toContain("back");

    // Advance to check-food choice
    const r6 = advanceDialogue("player-0", state);
    expect(r6.ok).toBe(true);
    if (!r6.ok) return;

    // "Here you go." should be enabled (player has 10 food)
    const handOver = r6.payload.options!.find((o) => o.label.includes("Here"));
    expect(handOver?.enabled).toBe(true);

    // Hand over food
    const r7 = chooseDialogue("player-0", handOver!.id, state);
    expect(r7.ok).toBe(true);
    expect(player.inventory.food).toBe(5); // 10 - 5
    expect(reed.getBelief("food_quest_active")?.value).toBe(false);
  });

  it("busy NPC: second player gets error", () => {
    addPlayer(state, "player-0", reed.position.x, reed.position.y - 1);
    addPlayer(state, "player-1", reed.position.x - 1, reed.position.y);

    startDialogue("player-0", "farmer-reed", state);
    const r = startDialogue("player-1", "farmer-reed", state);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("busy");
  });

  it("timeout: no response within DIALOGUE_TIMEOUT_TICKS → session expired", () => {
    addPlayer(state, "player-0", reed.position.x, reed.position.y - 1);

    startDialogue("player-0", "farmer-reed", state);
    expect(state.activeSessions.size).toBe(1);

    state.tick = DIALOGUE_TIMEOUT_TICKS;
    const expired = tickDialogues(state);
    expect(expired).toHaveLength(1);
    expect(expired[0].reason).toBe("timeout");
    expect(state.activeSessions.size).toBe(0);
    expect(state.agents.get("player-0")!.state).toBe("idle");
  });

  it("close: endDialogue clears session", () => {
    addPlayer(state, "player-0", reed.position.x, reed.position.y - 1);

    startDialogue("player-0", "farmer-reed", state);
    endDialogue("farmer-reed", state, "completed");

    expect(state.activeSessions.has("farmer-reed")).toBe(false);
    expect(state.agents.get("player-0")!.state).toBe("idle");
    expect(reed.currentTalkingTo).toBeNull();
  });

  it("disabled option: 'Here you go.' disabled without enough food", () => {
    const player = addPlayer(state, "player-0", reed.position.x, reed.position.y - 1);
    player.addToInventory("food", 2); // not enough

    // Set fact to enter check-return path
    reed.setBelief("food_quest_active", { key: "food_quest_active", value: true, tick: 0, source: "test" });

    startDialogue("player-0", "farmer-reed", state);
    const r = advanceDialogue("player-0", state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // getAllOptionsWithStatus includes all options; condition-gated ones appear as disabled
    const options = r.payload.options!;
    const handOver = options.find((o) => o.label.includes("Here"));
    expect(handOver).toBeDefined();
    expect(handOver!.enabled).toBe(false);
    const notYet = options.find((o) => o.label.includes("Not yet"));
    expect(notYet).toBeDefined();
    expect(notYet!.enabled).toBe(true);
  });
});
