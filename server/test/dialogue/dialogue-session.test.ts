import { describe, it, expect } from "vitest";
import { DialogueSession, type DialogueStateMessage } from "../../src/dialogue/dialogue-session.js";
import { Agent } from "../../src/simulation/agent.js";
import type { DialogueTreeData } from "@town-zero/shared";

function makeNpc(): Agent {
  return new Agent({
    id: "npc_elder",
    position: { x: 5, y: 5 },
    faction: "village",
    role: "elder",
    controller: "llm",
  });
}

function makePlayer(): Agent {
  return new Agent({
    id: "player-0",
    position: { x: 5, y: 6 },
    faction: "village",
    role: "player",
    controller: "player",
  });
}

// Simple linear tree: text -> choice -> end
const linearTree: DialogueTreeData = {
  id: "greet",
  root: "start",
  triggers: [],
  nodes: {
    start: { type: "text", speaker: "npc", content: ["Welcome, traveler!"], next: "choices" },
    choices: {
      type: "choice",
      options: [
        { id: "opt_thanks", label: ["Thank you"], next: "farewell" },
        { id: "opt_bye", label: ["Goodbye"], next: "end" },
      ],
    },
    farewell: { type: "text", speaker: "npc", content: ["Safe travels."], next: "end" },
    end: { type: "end" },
  },
};

// Tree with interpolation: uses fact_ref to show NPC belief in text
const interpTree: DialogueTreeData = {
  id: "interp-tree",
  root: "start",
  triggers: [],
  nodes: {
    start: {
      type: "text",
      speaker: "npc",
      content: ["Hello, ", { type: "fact_ref", key: "player_name" }, "!"],
      next: "end",
    },
    end: { type: "end" },
  },
};

// Tree with action node: text -> action -> end
const actionTree: DialogueTreeData = {
  id: "action-tree",
  root: "start",
  triggers: [],
  nodes: {
    start: { type: "text", speaker: "npc", content: ["Let me give you something."], next: "give" },
    give: {
      type: "action",
      effects: [
        { type: "set_fact", target: "$npc", key: "gave_gift", value: { type: "literal", value: true } },
      ],
      next: "after",
    },
    after: { type: "text", speaker: "npc", content: ["There you go."], next: "end" },
    end: { type: "end" },
  },
};

// Tree with request node
const requestTree: DialogueTreeData = {
  id: "request-tree",
  root: "start",
  triggers: [],
  nodes: {
    start: { type: "text", speaker: "npc", content: ["I need a favor."], next: "req" },
    req: { type: "request", label: ["Scout the north?"], gateType: "llm", nextYes: "yes", nextNo: "no" },
    yes: { type: "text", speaker: "npc", content: ["Great, I'll do it."], next: "end" },
    no: { type: "text", speaker: "npc", content: ["Sorry, no can do."], next: "end" },
    end: { type: "end" },
  },
};

describe("DialogueSession", () => {
  it("produces a text-type DialogueStateMessage at start", () => {
    const session = new DialogueSession({
      tree: linearTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    const state = session.getState();
    expect(state.type).toBe("text");
    expect(state.treeId).toBe("greet");
    expect(state.nodeId).toBe("start");
    expect(state.speaker).toBe("npc");
    expect(state.text).toBe("Welcome, traveler!");
  });

  it("advance() moves to the next node", () => {
    const session = new DialogueSession({
      tree: linearTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    const state = session.advance();
    expect(state.type).toBe("choice");
    expect(state.nodeId).toBe("choices");
    expect(state.options).toHaveLength(2);
    expect(state.options![0].id).toBe("opt_thanks");
    expect(state.options![0].label).toBe("Thank you");
    expect(state.options![1].id).toBe("opt_bye");
    expect(state.options![1].label).toBe("Goodbye");
  });

  it("select() picks an option and advances", () => {
    const session = new DialogueSession({
      tree: linearTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> choices
    const state = session.select("opt_thanks");
    expect(state.type).toBe("text");
    expect(state.text).toBe("Safe travels.");
    expect(state.nodeId).toBe("farewell");
  });

  it("returns end type when dialogue ends", () => {
    const session = new DialogueSession({
      tree: linearTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> choices
    const state = session.select("opt_bye");
    expect(state.type).toBe("end");
    expect(state.nodeId).toBe("end");
  });

  it("isEnded() returns true when dialogue reaches end node", () => {
    const session = new DialogueSession({
      tree: linearTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    expect(session.isEnded()).toBe(false);
    session.advance(); // -> choices
    session.select("opt_bye"); // -> end
    expect(session.isEnded()).toBe(true);
  });

  it("persists DialogueProgressEntry on end()", () => {
    const npc = makeNpc();
    const session = new DialogueSession({
      tree: linearTree,
      npc,
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> choices
    session.select("opt_thanks"); // -> farewell
    session.advance(); // -> end
    session.end();

    const progress = npc.getDialogueProgress("greet");
    expect(progress).toBeDefined();
    expect(progress!.visitedNodes).toEqual(["start", "choices", "farewell", "end"]);
    expect(progress!.selectedOptions).toEqual({ choices: "opt_thanks" });
    expect(progress!.locals).toEqual({});
  });

  it("getState() interpolates text with NPC beliefs", () => {
    const npc = makeNpc();
    npc.setBelief("player_name", {
      key: "player_name",
      value: "Marcus",
      tick: 1,
      source: "npc_elder",
    });

    const session = new DialogueSession({
      tree: interpTree,
      npc,
      player: makePlayer(),
      currentTick: 10,
    });

    const state = session.getState();
    expect(state.type).toBe("text");
    expect(state.text).toBe("Hello, Marcus!");
  });

  it("auto-advances through action nodes and executes effects", () => {
    const npc = makeNpc();
    const session = new DialogueSession({
      tree: actionTree,
      npc,
      player: makePlayer(),
      currentTick: 10,
    });

    // Start at text node "Let me give you something."
    expect(session.getState().text).toBe("Let me give you something.");

    // advance() should move past text -> action -> auto-advance to "after" text
    const state = session.advance();
    expect(state.type).toBe("text");
    expect(state.text).toBe("There you go.");
    expect(state.nodeId).toBe("after");

    // The set_fact effect should have fired
    const belief = npc.getBelief("gave_gift");
    expect(belief).toBeDefined();
    expect(belief!.value).toBe(true);
  });

  it("handles request nodes", () => {
    const session = new DialogueSession({
      tree: requestTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> req
    const reqState = session.getState();
    expect(reqState.type).toBe("request_pending");
    expect(reqState.text).toBe("Scout the north?");
  });

  it("resolveRequest(true) advances past request", () => {
    const session = new DialogueSession({
      tree: requestTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> req
    const state = session.resolveRequest(true);
    expect(state.type).toBe("text");
    expect(state.text).toBe("Great, I'll do it.");
  });

  it("resolveRequest(false) takes the no path", () => {
    const session = new DialogueSession({
      tree: requestTree,
      npc: makeNpc(),
      player: makePlayer(),
      currentTick: 10,
    });

    session.advance(); // -> req
    const state = session.resolveRequest(false);
    expect(state.type).toBe("text");
    expect(state.text).toBe("Sorry, no can do.");
  });

  it("loads existing dialogue progress locals on construction", () => {
    const npc = makeNpc();
    // Pre-set progress with a local variable
    npc.setDialogueProgress("local-tree", {
      visitedNodes: ["start"],
      selectedOptions: {},
      locals: { visit_count: 3 },
    });

    const tree: DialogueTreeData = {
      id: "local-tree",
      root: "start",
      triggers: [],
      nodes: {
        start: {
          type: "text",
          speaker: "npc",
          content: ["Visit count: ", { type: "local_ref", key: "visit_count" }],
          next: "end",
        },
        end: { type: "end" },
      },
    };

    const session = new DialogueSession({
      tree,
      npc,
      player: makePlayer(),
      currentTick: 10,
    });

    const state = session.getState();
    expect(state.text).toBe("Visit count: 3");
  });

  it("makeAgentAccessor exposes agent properties", () => {
    const npc = makeNpc();
    const player = makePlayer();
    player.addToInventory("food", 10);

    const tree: DialogueTreeData = {
      id: "accessor-tree",
      root: "start",
      triggers: [],
      nodes: {
        start: {
          type: "text",
          speaker: "npc",
          content: [
            "Your food: ",
            { type: "prop_ref", target: "player", prop: "food" },
          ],
          next: "end",
        },
        end: { type: "end" },
      },
    };

    const session = new DialogueSession({
      tree,
      npc,
      player,
      currentTick: 10,
    });

    const state = session.getState();
    expect(state.text).toBe("Your food: 10");
  });
});
