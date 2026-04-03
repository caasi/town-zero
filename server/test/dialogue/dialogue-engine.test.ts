import { describe, it, expect } from "vitest";
import { DialogueEngine } from "../../src/dialogue/dialogue-engine.js";
import type { DialogueTreeData, Fact, Value } from "@town-zero/shared";
import type { EvalContext } from "../../src/dialogue/evaluator.js";
import type { MutableContext } from "../../src/dialogue/executor.js";

const testTree: DialogueTreeData = {
  id: "test-tree",
  root: "start",
  triggers: [],
  nodes: {
    start: { type: "text", speaker: "npc", content: ["Hello traveler!"], next: "choices" },
    choices: {
      type: "choice",
      options: [
        { id: "opt_help", label: ["Ask for help"], next: "request" },
        { id: "opt_bye", label: ["Goodbye"], next: "end" },
      ],
    },
    request: { type: "request", label: ["Scout the north"], gateType: "llm", nextYes: "yes", nextNo: "no" },
    yes: { type: "text", speaker: "npc", content: ["Sure, I'll go scout."], next: "end" },
    no: { type: "text", speaker: "npc", content: ["Sorry, I'm too busy."], next: "end" },
    end: { type: "end" },
  },
};

function makeEvalCtx(beliefs: Record<string, Fact> = {}): EvalContext {
  return {
    beliefs: new Map(Object.entries(beliefs)),
    locals: new Map(),
    agentState: {
      player: { get: () => 0 },
      npc: { get: () => 0 },
      settlement: null,
    },
    currentTick: 1,
  };
}

describe("DialogueEngine", () => {
  it("starts at root node", () => {
    const engine = new DialogueEngine(testTree);
    const node = engine.getCurrentNode();
    expect(node.type).toBe("text");
    if (node.type === "text") {
      expect(node.content).toEqual(["Hello traveler!"]);
    }
  });

  it("advances through text nodes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    expect(engine.getCurrentNode().type).toBe("choice");
  });

  it("selects a choice option by index", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    expect(engine.getCurrentNode().type).toBe("request");
  });

  it("resolves request node with yes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    engine.resolveRequest(true);
    const node = engine.getCurrentNode();
    if (node.type === "text") {
      expect(node.content).toEqual(["Sure, I'll go scout."]);
    }
  });

  it("resolves request node with no", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    engine.resolveRequest(false);
    const node = engine.getCurrentNode();
    if (node.type === "text") {
      expect(node.content).toEqual(["Sorry, I'm too busy."]);
    }
  });

  it("detects end of dialogue", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(1);
    expect(engine.isEnded()).toBe(true);
  });

  it("throws on missing node id", () => {
    const brokenTree: DialogueTreeData = {
      id: "broken",
      root: "start",
      triggers: [],
      nodes: {
        start: { type: "text", speaker: "npc", content: ["Hello"], next: "nonexistent" },
      },
    };
    const engine = new DialogueEngine(brokenTree);
    engine.advance();
    expect(() => engine.getCurrentNode()).toThrow();
  });

  it("getInterpolatedContent interpolates text templates", () => {
    const tree: DialogueTreeData = {
      id: "interp",
      root: "greet",
      triggers: [],
      nodes: {
        greet: {
          type: "text",
          speaker: "npc",
          content: ["Hello ", { type: "fact_ref", key: "player_name" }, "!"],
          next: "end",
        },
        end: { type: "end" },
      },
    };
    const engine = new DialogueEngine(tree);
    const ctx = makeEvalCtx({ player_name: { key: "player_name", value: "Marcus", tick: 1, source: "a" } });
    expect(engine.getInterpolatedContent(ctx)).toBe("Hello Marcus!");
  });

  it("getVisibleOptions filters by condition", () => {
    const tree: DialogueTreeData = {
      id: "cond",
      root: "ch",
      triggers: [],
      nodes: {
        ch: {
          type: "choice",
          options: [
            {
              id: "opt_a",
              label: ["Secret option"],
              condition: { type: "compare", op: "gt", left: { type: "fact_ref", key: "rep" }, right: { type: "literal", value: 5 } },
              next: "end",
            },
            { id: "opt_b", label: ["Normal option"], next: "end" },
          ],
        },
        end: { type: "end" },
      },
    };
    const engine = new DialogueEngine(tree);

    // rep = 3 (too low)
    const ctxLow = makeEvalCtx({ rep: { key: "rep", value: 3, tick: 1, source: "a" } });
    expect(engine.getVisibleOptions(ctxLow)).toHaveLength(1);
    expect(engine.getVisibleOptions(ctxLow)[0].id).toBe("opt_b");

    // rep = 10 (high enough)
    const ctxHigh = makeEvalCtx({ rep: { key: "rep", value: 10, tick: 1, source: "a" } });
    expect(engine.getVisibleOptions(ctxHigh)).toHaveLength(2);
  });

  it("advanceWithEffects executes action node effects", () => {
    const tree: DialogueTreeData = {
      id: "effects",
      root: "act",
      triggers: [],
      nodes: {
        act: {
          type: "action",
          effects: [
            { type: "set_fact", target: "$npc", key: "quest_done", value: { type: "literal", value: true } },
          ],
          next: "end",
        },
        end: { type: "end" },
      },
    };
    const engine = new DialogueEngine(tree);
    const factsSet: Array<{ ref: string; key: string; value: Value }> = [];
    const ctx: MutableContext = {
      beliefs: new Map(),
      locals: new Map(),
      agentState: {
        player: { get: () => 0 },
        npc: { get: () => 0 },
        settlement: null,
      },
      currentTick: 1,
      npcId: "npc_a",
      setFact(ref, key, value) { factsSet.push({ ref, key, value }); },
      setLocal() {},
      giveItem() {},
      takeItem() { return true; },
      damage() {},
      registerTrigger() {},
    };

    engine.advanceWithEffects(ctx);
    expect(factsSet).toEqual([{ ref: "$npc", key: "quest_done", value: true }]);
    expect(engine.isEnded()).toBe(true);
  });

  it("tracks visited nodes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance(); // start -> choices
    engine.selectOption(1); // choices -> end
    expect(engine.getVisitedNodes()).toEqual(["start", "choices", "end"]);
  });

  it("selectOptionById selects by option id", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOptionById("opt_help");
    expect(engine.getCurrentNode().type).toBe("request");
  });

  it("getTreeId returns tree id", () => {
    const engine = new DialogueEngine(testTree);
    expect(engine.getTreeId()).toBe("test-tree");
  });

  it("getSelectedOptions tracks selected option ids", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOptionById("opt_help");
    expect(engine.getSelectedOptions()).toEqual({ choices: "opt_help" });
  });

  it("getInterpolatedContent returns empty string for non-text nodes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance(); // now at choice node
    const ctx = makeEvalCtx();
    expect(engine.getInterpolatedContent(ctx)).toBe("");
  });

  it("getVisibleOptions returns empty array for non-choice nodes", () => {
    const engine = new DialogueEngine(testTree);
    // at text node
    const ctx = makeEvalCtx();
    expect(engine.getVisibleOptions(ctx)).toEqual([]);
  });
});
