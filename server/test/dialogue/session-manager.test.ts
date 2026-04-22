import { describe, it, expect, beforeEach } from "vitest";
import { DIALOGUE_TIMEOUT_TICKS } from "@town-zero/shared";
import { startDialogue, advanceDialogue, chooseDialogue, endDialogue, tickDialogues } from "../../src/dialogue/session-manager.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { DialogueTreeData } from "@town-zero/shared";
import { bubble } from "@town-zero/shared/script-dsl";
import type { EventHandler } from "@town-zero/shared/script-dsl";

function makeTree(): DialogueTreeData {
  return {
    id: "test-npc-dialogue",
    root: "greeting",
    nodes: {
      greeting: { type: "text", speaker: "npc", content: ["Hello!"], next: "offer" },
      offer: {
        type: "choice",
        options: [
          { id: "accept", label: ["Yes"], next: "thanks" },
          { id: "decline", label: ["No"], next: "bye" },
        ],
      },
      thanks: { type: "text", speaker: "npc", content: ["Great!"], next: "done" },
      bye: { type: "text", speaker: "npc", content: ["Goodbye."], next: "done" },
      done: { type: "end" },
    },
    triggers: [],
  };
}

function makeRequestTree(): DialogueTreeData {
  return {
    id: "test-npc-dialogue",
    root: "greeting",
    nodes: {
      greeting: { type: "text", speaker: "npc", content: ["Hello!"], next: "ask" },
      ask: {
        type: "choice",
        options: [
          { id: "scout", label: ["Scout?"], next: "scout-request" },
        ],
      },
      "scout-request": { type: "request", label: ["Scout the north"], gateType: "llm", nextYes: "accepted", nextNo: "rejected" },
      accepted: { type: "text", speaker: "npc", content: ["On it!"], next: "done" },
      rejected: { type: "text", speaker: "npc", content: ["Maybe later."], next: "done" },
      done: { type: "end" },
    },
    triggers: [],
  };
}

function makeState(): SimulationState {
  const grid = new Grid(10, 10);
  const agents = new Map<string, Agent>();

  const npc = new Agent({ id: "test-npc", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "bot" });
  const player = new Agent({ id: "player-0", position: { x: 5, y: 4 }, faction: "village-1", role: "player", controller: "player" });
  agents.set("test-npc", npc);
  agents.set("player-0", player);

  const dialogueTrees = new Map<string, DialogueTreeData>();
  dialogueTrees.set("test-npc-dialogue", makeTree());

  return {
    grid,
    agents,
    settlements: new Map(),
    tick: 10,
    nextMerchantId: 0,
    activeSessions: new Map(),
    dialogueTrees,
  };
}

describe("session-manager", () => {
  let state: SimulationState;

  beforeEach(() => {
    state = makeState();
  });

  describe("startDialogue", () => {
    it("creates session and locks both agents", () => {
      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(true);

      const player = state.agents.get("player-0")!;
      const npc = state.agents.get("test-npc")!;
      expect(player.talkingToNpcId).toBe("test-npc");
      expect(npc.currentTalkingTo).toBe("player-0");
      expect(state.activeSessions.has("test-npc")).toBe(true);
    });

    it("returns dialogue:state payload with text node", () => {
      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.nodeType).toBe("text");
      expect(result.payload.content).toBe("Hello!");
      expect(result.payload.npcId).toBe("test-npc");
    });

    it("auto-faces player toward NPC", () => {
      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(true);
      // Player is at (5,4), NPC at (5,5) → player should face south
      expect(state.agents.get("player-0")!.facing).toBe("south");
    });

    it("returns error if NPC is busy", () => {
      startDialogue("player-0", "test-npc", state);

      const player2 = new Agent({ id: "player-1", position: { x: 4, y: 5 }, faction: "village-1", role: "player", controller: "player" });
      state.agents.set("player-1", player2);

      const result = startDialogue("player-1", "test-npc", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("busy");
    });

    it("returns error if not adjacent", () => {
      state.agents.get("player-0")!.position = { x: 0, y: 0 };
      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("too_far");
    });

    it("returns error if NPC has no dialogue tree", () => {
      const npc2 = new Agent({ id: "silent-npc", position: { x: 5, y: 3 }, faction: "village-1", role: "farmer", controller: "bot" });
      state.agents.set("silent-npc", npc2);
      state.agents.get("player-0")!.position = { x: 5, y: 3 - 1 };

      // silent-npc has no tree in dialogueTrees
      // But player is adjacent at (5,2), npc at (5,3) — distance 1
      state.agents.get("player-0")!.position = { x: 5, y: 2 };
      const result = startDialogue("player-0", "silent-npc", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("no_dialogue");
    });

    it("returns request_pending nodeType for request nodes", () => {
      state.dialogueTrees.set("test-npc-dialogue", makeRequestTree());
      startDialogue("player-0", "test-npc", state);
      advanceDialogue("player-0", state); // greeting → ask (choice)
      const result = chooseDialogue("player-0", "scout", state); // ask → scout-request

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.nodeType).toBe("request_pending");
      expect(result.payload.content).toBe("Scout the north");
    });

    it("clears an active NPC bubble on startDialogue even without a talk:start handler", () => {
      const npc = state.agents.get("test-npc")!;
      npc.setBubble("Hi!", 80, 0);
      expect(npc.bubbleText).toBe("Hi!");

      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(true);
      expect(npc.bubbleText).toBeNull();
      expect(npc.bubbleExpiresAt).toBe(0);
    });

    it("lets a talk:start handler clear the target NPC's active bubble", () => {
      const npc = state.agents.get("test-npc")!;
      npc.setBubble("早安", 80, 0);
      expect(npc.bubbleText).toBe("早安");
      expect(npc.bubbleExpiresAt).toBe(80);

      npc.eventHandlers.set("talk:start", [
        (({ self }: { self: { id: string } }) => [bubble(self.id, "", { durationTicks: 0 })]) as EventHandler<unknown>,
      ]);

      const result = startDialogue("player-0", "test-npc", state);
      expect(result.ok).toBe(true);
      expect(npc.bubbleText).toBeNull();
      expect(npc.bubbleExpiresAt).toBe(0);
    });

    it("evaluates entryPoints for conditional root", () => {
      const tree = makeTree();
      tree.entryPoints = [
        { nodeId: "thanks", condition: { type: "fact_ref", key: "quest_done" } },
      ];
      state.dialogueTrees.set("test-npc-dialogue", tree);

      // Without the fact, should use default root
      const r1 = startDialogue("player-0", "test-npc", state);
      expect(r1.ok).toBe(true);
      if (r1.ok) expect(r1.payload.content).toBe("Hello!");

      // Clean up and set fact
      endDialogue("test-npc", state, "completed");
      state.agents.get("test-npc")!.setBelief("quest_done", { key: "quest_done", value: true, tick: 1, source: "test" });

      const r2 = startDialogue("player-0", "test-npc", state);
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.payload.content).toBe("Great!");
    });
  });

  describe("advanceDialogue", () => {
    it("advances text node and returns next state", () => {
      startDialogue("player-0", "test-npc", state);
      const result = advanceDialogue("player-0", state);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.nodeType).toBe("choice");
      expect(result.payload.options).toHaveLength(2);
    });

    it("returns error if player not in dialogue", () => {
      const result = advanceDialogue("player-0", state);
      expect(result.ok).toBe(false);
    });

    it("returns error when current node is choice (not advanceable)", () => {
      startDialogue("player-0", "test-npc", state);
      advanceDialogue("player-0", state); // greeting → offer (choice node)

      const result = advanceDialogue("player-0", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("wrong_node_type");
    });

    it("returns error when current node is request (not advanceable)", () => {
      state.dialogueTrees.set("test-npc-dialogue", makeRequestTree());
      startDialogue("player-0", "test-npc", state);
      advanceDialogue("player-0", state); // greeting → ask (choice)
      chooseDialogue("player-0", "scout", state); // ask → scout-request

      const result = advanceDialogue("player-0", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("wrong_node_type");
    });

    it("updates lastInteractionTick", () => {
      startDialogue("player-0", "test-npc", state);
      state.tick = 20;
      advanceDialogue("player-0", state);
      const session = state.activeSessions.get("test-npc")!;
      expect(session.lastInteractionTick).toBe(20);
    });
  });

  describe("chooseDialogue", () => {
    it("selects option and advances", () => {
      startDialogue("player-0", "test-npc", state);
      advanceDialogue("player-0", state); // greeting → offer

      const result = chooseDialogue("player-0", "accept", state);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.payload.content).toBe("Great!");
    });

    it("returns error for invalid option", () => {
      startDialogue("player-0", "test-npc", state);
      advanceDialogue("player-0", state); // greeting → offer

      const result = chooseDialogue("player-0", "nonexistent", state);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("invalid_option");
    });
  });

  describe("endDialogue", () => {
    it("clears session and unlocks both agents", () => {
      startDialogue("player-0", "test-npc", state);
      endDialogue("test-npc", state, "completed");

      expect(state.activeSessions.has("test-npc")).toBe(false);
      expect(state.agents.get("player-0")!.state).toBe("idle");
      expect(state.agents.get("player-0")!.talkingToNpcId).toBeNull();
      expect(state.agents.get("test-npc")!.currentTalkingTo).toBeNull();
    });
  });

  describe("tickDialogues", () => {
    it("times out expired sessions", () => {
      const r = startDialogue("player-0", "test-npc", state);
      expect(r.ok).toBe(true);
      expect(state.activeSessions.size).toBe(1);
      const session = state.activeSessions.get("test-npc")!;
      expect(session.lastInteractionTick).toBe(10);
      state.tick = 10 + DIALOGUE_TIMEOUT_TICKS;
      expect(state.tick - session.lastInteractionTick).toBe(DIALOGUE_TIMEOUT_TICKS);

      const expired = tickDialogues(state);
      expect(expired).toHaveLength(1);
      expect(expired[0].playerId).toBe("player-0");
      expect(expired[0].reason).toBe("timeout");

      // Session should be cleaned up
      expect(state.activeSessions.has("test-npc")).toBe(false);
      expect(state.agents.get("player-0")!.state).toBe("idle");
    });

    it("does not timeout active sessions", () => {
      startDialogue("player-0", "test-npc", state);
      state.tick = 10 + Math.floor(DIALOGUE_TIMEOUT_TICKS / 2); // half the timeout

      const expired = tickDialogues(state);
      expect(expired).toHaveLength(0);
      expect(state.activeSessions.has("test-npc")).toBe(true);
    });
  });
});
