import { describe, it, expect, vi } from "vitest";
import { ReplyController, describeReplyState } from "../../src/ai/reply-controller.js";
import type { Choice } from "../../src/ai/jev.js";
import { startDialogue, advanceDialogue, chooseDialogue, endDialogue } from "../../src/dialogue/session-manager.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import { updateStoreKnowledge } from "../../src/simulation/vision.js";
import type { DialogueTreeData } from "@town-zero/shared";

const tree: DialogueTreeData = {
  id: "reed-talk",
  root: "ask",
  nodes: {
    ask: { type: "choice", options: [{ id: "ask_opt_0", label: ["What's in it for me?"], next: "answer" }] },
    answer: {
      type: "reply",
      lines: [
        { id: "calm", description: "Explain calmly.", text: ["The village needs it."], next: "end" },
        { id: "curt", description: "Answer curtly.", text: ["Help or leave."], next: "end" },
      ],
    },
    end: { type: "end" },
  },
};

function waitingState(): SimulationState {
  const reed = new Agent({ id: "reed", name: "Farmer Reed", position: { x: 5, y: 5 }, faction: "v", role: "farmer", controller: "bot" });
  reed.profile = { gender: { kind: "male" }, personality: "He cares most about the village.", farewells: [] };
  const player = new Agent({ id: "player-0", position: { x: 5, y: 6 }, faction: "v", role: "player", controller: "player" });
  const village = new Settlement({ id: "v", faction: "v", type: "village", territory: [{ x: 5, y: 5 }] });
  village.addResource("food", 12);
  village.populationIds.push("reed");
  const state: SimulationState = {
    grid: new Grid(10, 10),
    agents: new Map([["reed", reed], ["player-0", player]]),
    settlements: new Map([["v", village]]),
    tick: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map([["reed-talk", tree]]),
  };
  reed.setBelief("food_quest_active", { key: "food_quest_active", value: true, tick: 0, source: "reed" });
  startDialogue("player-0", "reed", state);
  chooseDialogue("player-0", "ask_opt_0", state);
  return state;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ReplyController", () => {
  it("asks Jev once per waiting reply, with the lines as options", async () => {
    const state = waitingState();
    const choose = vi.fn().mockResolvedValue({ id: "curt" } satisfies Choice);
    const replies = new ReplyController(choose);
    replies.update(state);
    replies.update(state);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose.mock.calls[0][2]).toEqual({ calm: "Explain calmly.", curt: "Answer curtly." });
  });

  it("returns the session once Jev answers, showing the picked line", async () => {
    const state = waitingState();
    const replies = new ReplyController(vi.fn().mockResolvedValue({ id: "curt" }));
    expect(replies.update(state)).toEqual([]);
    await flush();
    const [session] = replies.update(state);
    expect(session.getState()).toMatchObject({ type: "text", text: "Help or leave." });
    expect(replies.update(state)).toEqual([]);
  });

  it("falls back to the first line when the call fails", async () => {
    const state = waitingState();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const replies = new ReplyController(vi.fn().mockRejectedValue(new Error("down")));
    try {
      replies.update(state);
      await flush();
      const [session] = replies.update(state);
      expect(session.getState()).toMatchObject({ text: "The village needs it." });
    } finally {
      error.mockRestore();
    }
  });

  it("picks the first line at once without a key", () => {
    const state = waitingState();
    const [session] = new ReplyController(null).update(state);
    expect(session.getState()).toMatchObject({ text: "The village needs it." });
  });

  it("drops an answer that arrives after the dialogue ended", async () => {
    const state = waitingState();
    let answer!: (c: Choice) => void;
    const replies = new ReplyController(() => new Promise((r) => (answer = r)));
    replies.update(state);
    endDialogue("reed", state, "player_left");
    answer({ id: "curt" });
    await flush();
    expect(replies.update(state)).toEqual([]);
  });

  it("drops an old answer when the same NPC already talks in a new dialogue", async () => {
    const state = waitingState();
    const answers: Array<(c: Choice) => void> = [];
    const replies = new ReplyController(() => new Promise((r) => answers.push(r)));
    replies.update(state); // the first dialogue asks
    endDialogue("reed", state, "player_left");
    startDialogue("player-0", "reed", state);
    chooseDialogue("player-0", "ask_opt_0", state);
    replies.update(state); // the second dialogue asks
    const second = state.activeSessions.get("reed")!;

    answers[0]({ id: "curt" }); // the first answer comes late
    await flush();
    expect(replies.update(state)).toEqual([]);
    expect(second.isWaiting()).toBe(true);

    answers[1]({ id: "calm" });
    await flush();
    expect(replies.update(state)).toEqual([second]);
    expect(second.getState()).toMatchObject({ text: "The village needs it." });
  });

  it("asks Jev again only when the state differs (the pick is cached)", async () => {
    const state = waitingState();
    const choose = vi.fn().mockResolvedValue({ id: "curt" });
    const replies = new ReplyController(choose);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      replies.update(state);
      await flush();
      replies.update(state);
      const again = () => {
        endDialogue("reed", state, "completed");
        startDialogue("player-0", "reed", state);
        chooseDialogue("player-0", "ask_opt_0", state);
        return replies.update(state);
      };
      const [cached] = again(); // same state: answered from the cache, on this tick
      expect(choose).toHaveBeenCalledTimes(1);
      expect(cached.getState()).toMatchObject({ text: "Help or leave." });
      expect(log).toHaveBeenCalledWith("[jev] reed replied curt from calm, curt (cached)");

      state.settlements.get("v")!.addResource("food", 100); // the state changes
      again();
      expect(choose).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("does not cache the fallback of a failed call", async () => {
    const state = waitingState();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const choose = vi.fn().mockRejectedValue(new Error("down"));
    const replies = new ReplyController(choose);
    try {
      replies.update(state);
      await flush();
      replies.update(state);
      endDialogue("reed", state, "completed");
      startDialogue("player-0", "reed", state);
      chooseDialogue("player-0", "ask_opt_0", state);
      replies.update(state);
      expect(choose).toHaveBeenCalledTimes(2);
      await flush(); // let the second failure log while the spy is on
    } finally {
      error.mockRestore();
    }
  });

  it("logs the pick with its token counts", async () => {
    const state = waitingState();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      new ReplyController(vi.fn().mockResolvedValue({ id: "curt", usage: { input: 300, output: 20 } })).update(state);
      await flush();
      expect(log).toHaveBeenCalledWith("[jev] reed replied curt from calm, curt (in 300, out 20)");
    } finally {
      log.mockRestore();
    }
  });
});

describe("describeReplyState", () => {
  it("describes the NPC, what the player said and the village in words", () => {
    const state = waitingState();
    const reed = state.agents.get("reed")!;
    expect(describeReplyState(reed, "What's in it for me?", state)).toEqual({
      npc: "Farmer Reed, a farmer of the village",
      gender: "Farmer Reed is a man.",
      personality: "He cares most about the village.",
      beliefs: ["food quest active: true"],
      village: "the storehouse holds 12 food (low)",
      player_said: "What's in it for me?",
    });
  });

  it("leaves out the store count that agents keep as a belief", () => {
    // The village line gives the store; the belief changes with every
    // deposit and would make each reply a new cache key, so a paid call.
    const state = waitingState();
    const reed = state.agents.get("reed")!;
    updateStoreKnowledge(reed, state.settlements, state.tick);
    expect(reed.getAllBeliefs().size).toBe(2);
    expect(describeReplyState(reed, null, state).beliefs).toEqual(["food quest active: true"]);
  });
});
