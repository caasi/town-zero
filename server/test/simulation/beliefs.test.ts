import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import type { Fact } from "@town-zero/shared";

function makeAgent(id = "a"): Agent {
  return new Agent({ id, position: { x: 0, y: 0 }, faction: "v1", role: "scout", controller: "bot" });
}

describe("Agent beliefs", () => {
  it("starts with empty beliefs", () => {
    const agent = makeAgent();
    expect(agent.getAllBeliefs().size).toBe(0);
  });

  it("set and get a belief", () => {
    const agent = makeAgent();
    agent.setBelief("bridge_status", { key: "bridge_status", value: "destroyed", tick: 5, source: "a" });
    const fact = agent.getBelief("bridge_status");
    expect(fact?.value).toBe("destroyed");
  });

  it("mergeBeliefs keeps newer tick", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    a.setBelief("x", { key: "x", value: "old", tick: 1, source: "a" });
    b.setBelief("x", { key: "x", value: "new", tick: 5, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("x")?.value).toBe("new");
    expect(a.getBelief("x")?.tick).toBe(5);
  });

  it("mergeBeliefs does not overwrite newer with older", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    a.setBelief("x", { key: "x", value: "newer", tick: 10, source: "a" });
    b.setBelief("x", { key: "x", value: "older", tick: 1, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("x")?.value).toBe("newer");
  });

  it("mergeBeliefs adds beliefs target doesn't have", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    b.setBelief("y", { key: "y", value: true, tick: 3, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("y")?.value).toBe(true);
  });
});

describe("Agent dialogueProgress", () => {
  it("starts with empty progress", () => {
    const agent = makeAgent();
    expect(agent.getDialogueProgress("tree1")).toBeUndefined();
  });

  it("set and get progress", () => {
    const agent = makeAgent();
    agent.setDialogueProgress("tree1", {
      visitedNodes: ["greeting", "main"],
      selectedOptions: { main: "opt_0" },
      locals: { cost: 5 },
    });
    const progress = agent.getDialogueProgress("tree1");
    expect(progress?.visitedNodes).toContain("greeting");
    expect(progress?.locals.cost).toBe(5);
  });
});
