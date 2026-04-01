import { describe, it, expect } from "vitest";
import { DialogueEngine } from "../../src/dialogue/dialogue-engine.js";
import type { DialogueTree } from "@town-zero/shared";

const testTree: DialogueTree = {
  id: "test-tree",
  root: "start",
  nodes: {
    start: { type: "text", speaker: "npc", content: "Hello traveler!", next: "choices" },
    choices: {
      type: "choice",
      options: [
        { label: "Ask for help", next: "request" },
        { label: "Goodbye", next: "end" },
      ],
    },
    request: { type: "request", label: "Scout the north", gateType: "llm", nextYes: "yes", nextNo: "no" },
    yes: { type: "text", speaker: "npc", content: "Sure, I'll go scout.", next: "end" },
    no: { type: "text", speaker: "npc", content: "Sorry, I'm too busy.", next: "end" },
    end: { type: "end" },
  },
};

describe("DialogueEngine", () => {
  it("starts at root node", () => {
    const engine = new DialogueEngine(testTree);
    const node = engine.getCurrentNode();
    expect(node.type).toBe("text");
    if (node.type === "text") {
      expect(node.content).toBe("Hello traveler!");
    }
  });

  it("advances through text nodes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    expect(engine.getCurrentNode().type).toBe("choice");
  });

  it("selects a choice option", () => {
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
      expect(node.content).toContain("scout");
    }
  });

  it("resolves request node with no", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    engine.resolveRequest(false);
    const node = engine.getCurrentNode();
    if (node.type === "text") {
      expect(node.content).toContain("busy");
    }
  });

  it("detects end of dialogue", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(1);
    expect(engine.isEnded()).toBe(true);
  });

  it("throws on missing node id", () => {
    const brokenTree: DialogueTree = {
      id: "broken",
      root: "start",
      nodes: {
        start: { type: "text", speaker: "npc", content: "Hello", next: "nonexistent" },
      },
    };
    const engine = new DialogueEngine(brokenTree);
    engine.advance(); // moves to "nonexistent"
    expect(() => engine.getCurrentNode()).toThrow();
  });
});
