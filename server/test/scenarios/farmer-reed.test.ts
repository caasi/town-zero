import { describe, it, expect, beforeEach } from "vitest";
import { farmerReedScenario } from "../../src/scenarios/farmer-reed.js";
import { loadScenario } from "../../src/simulation/scenario-loader.js";
import { Grid } from "../../src/simulation/grid.js";
import { startDialogue, advanceDialogue, chooseDialogue, buildPayload } from "../../src/dialogue/session-manager.js";
import { ReplyController } from "../../src/ai/reply-controller.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import { Agent } from "../../src/simulation/agent.js";

function makeState(): SimulationState {
  const grid = new Grid(10, 10);
  const agents = new Map<string, Agent>();
  return {
    grid,
    agents,
    settlements: new Map(),
    tick: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map(),
  };
}

describe("farmer-reed scenario", () => {
  it("builds without error", () => {
    expect(farmerReedScenario).toBeDefined();
    expect(farmerReedScenario.id).toBe("farmer-reed");
    expect(farmerReedScenario.npcs).toHaveLength(1);
    expect(farmerReedScenario.dialogues).toHaveLength(1);
  });

  it("tree has expected nodes", () => {
    const tree = farmerReedScenario.dialogues[0];
    expect(tree.root).toBe("greeting");
    expect(tree.nodes["greeting"]).toBeDefined();
    expect(tree.nodes["quest-offer"]).toBeDefined();
    expect(tree.nodes["accept"]).toBeDefined();
    expect(tree.nodes["accept-text"]).toBeDefined();
    expect(tree.nodes["haggle"]).toBeDefined();
    expect(tree.nodes["refuse"]).toBeDefined();
    expect(tree.nodes["check-return"]).toBeDefined();
    expect(tree.nodes["check-food"]).toBeDefined();
    expect(tree.nodes["hand-over"]).toBeDefined();
    expect(tree.nodes["thanks"]).toBeDefined();
    expect(tree.nodes["not-yet"]).toBeDefined();
    expect(tree.nodes["done"]).toBeDefined();
  });

  it("has entryPoints: conditional check-return first, default greeting last", () => {
    const tree = farmerReedScenario.dialogues[0];
    expect(tree.entryPoints).toHaveLength(2);
    expect(tree.entryPoints![0].nodeId).toBe("check-return");
    expect(tree.entryPoints![1].nodeId).toBe("greeting");
  });

  describe("full walkthrough", () => {
    let state: SimulationState;

    beforeEach(() => {
      state = makeState();
      const { dialogueTrees } = loadScenario(farmerReedScenario, state);
      state.dialogueTrees = dialogueTrees;

      const reed = state.agents.get("farmer-reed")!;
      const player = new Agent({
        id: "player-0",
        position: { x: reed.position.x, y: reed.position.y - 1 },
        faction: "village-1",
        role: "player",
        controller: "player",
      });
      player.addToInventory("food", 10);
      state.agents.set("player-0", player);
    });

    it("accept quest → return with food → hand over", () => {
      const r1 = startDialogue("player-0", "farmer-reed", state);
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      expect(r1.payload.nodeType).toBe("text");
      expect(r1.payload.content).toContain("food");

      const r2 = advanceDialogue("player-0", state);
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      expect(r2.payload.nodeType).toBe("choice");
      expect(r2.payload.options).toBeDefined();

      const acceptOpt = r2.payload.options!.find((o) => o.label.toLowerCase().includes("sure") || o.label.toLowerCase().includes("help"));
      expect(acceptOpt).toBeDefined();

      const r3 = chooseDialogue("player-0", acceptOpt!.id, state);
      expect(r3.ok).toBe(true);
      if (!r3.ok) return;
      expect(r3.payload.nodeType).toBe("text");

      const reed = state.agents.get("farmer-reed")!;
      expect(reed.getBelief("food_quest_active")?.value).toBe(true);

      const r4 = advanceDialogue("player-0", state);
      expect(r4.ok).toBe(true);

      expect(state.activeSessions.has("farmer-reed")).toBe(false);

      const r5 = startDialogue("player-0", "farmer-reed", state);
      expect(r5.ok).toBe(true);
      if (!r5.ok) return;
      expect(r5.payload.content).toContain("back");

      const r6 = advanceDialogue("player-0", state);
      expect(r6.ok).toBe(true);
      if (!r6.ok) return;
      expect(r6.payload.nodeType).toBe("choice");

      const handOverOpt = r6.payload.options!.find((o) => o.label.toLowerCase().includes("here"));
      expect(handOverOpt).toBeDefined();

      const r7 = chooseDialogue("player-0", handOverOpt!.id, state);
      expect(r7.ok).toBe(true);
      if (!r7.ok) return;
      expect(r7.payload.nodeType).toBe("text");

      const player = state.agents.get("player-0")!;
      expect(player.inventory.food).toBe(5);
      expect(reed.getBelief("food_quest_active")?.value).toBe(false);
    });

    it("haggle loops back to quest-offer", () => {
      startDialogue("player-0", "farmer-reed", state);
      const r1 = advanceDialogue("player-0", state);
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;

      const haggleOpt = r1.payload.options!.find((o) => o.label.toLowerCase().includes("what"));
      expect(haggleOpt).toBeDefined();

      const r2 = chooseDialogue("player-0", haggleOpt!.id, state);
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      expect(r2.payload.content).toBe("…");
      const [session] = new ReplyController(null).update(state);
      expect(buildPayload(session, state).content).toContain("same storehouse");

      const r3 = advanceDialogue("player-0", state);
      expect(r3.ok).toBe(true);
      if (!r3.ok) return;
      expect(r3.payload.nodeType).toBe("choice");
    });

    it("entry point routes to check-return when food_quest_active", () => {
      const reed = state.agents.get("farmer-reed")!;
      reed.setBelief("food_quest_active", { key: "food_quest_active", value: true, tick: 0, source: "test" });

      const r = startDialogue("player-0", "farmer-reed", state);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.payload.content).toContain("back");
    });
  });
});
