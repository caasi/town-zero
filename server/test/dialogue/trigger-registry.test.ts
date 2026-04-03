import { describe, it, expect } from "vitest";
import { TriggerRegistry } from "../../src/dialogue/trigger-registry.js";
import type { TriggerRule, Fact } from "@town-zero/shared";

function makeRule(overrides: Partial<TriggerRule> = {}): TriggerRule {
  return {
    id: "test:0",
    when: { type: "compare", op: "eq", left: { type: "fact_ref", key: "x" }, right: { type: "literal", value: true } },
    then: [{ type: "set_fact", target: "$npc", key: "y", value: { type: "literal", value: true } }],
    targets: ["npc_a"],
    once: false,
    source: "scenario",
    fired: false,
    ...overrides,
  };
}

describe("TriggerRegistry", () => {
  it("registers and retrieves triggers", () => {
    const reg = new TriggerRegistry();
    const rule = makeRule();
    reg.register(rule);
    expect(reg.getAll()).toHaveLength(1);
  });

  it("recordChangedFact tracks keys", () => {
    const reg = new TriggerRegistry();
    reg.recordChangedFact("x");
    reg.recordChangedFact("y");
    expect(reg.getChangedFacts()).toContain("x");
    expect(reg.getChangedFacts()).toContain("y");
  });

  it("evaluateBatch fires matching triggers", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("x");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("test:0");
  });

  it("does not fire when condition is false", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("x");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: false, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(0);
  });

  it("does not fire if no relevant fact changed", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("unrelated_key");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(0);
  });

  it("once: true trigger fires only once", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule({ once: true }));

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);

    reg.recordChangedFact("x");
    const fired1 = reg.evaluateBatch(beliefs, 1);
    expect(fired1).toHaveLength(1);

    reg.recordChangedFact("x");
    const fired2 = reg.evaluateBatch(beliefs, 2);
    expect(fired2).toHaveLength(0);
  });

  it("clearChangedFacts resets for next tick", () => {
    const reg = new TriggerRegistry();
    reg.recordChangedFact("x");
    reg.clearChangedFacts();
    expect(reg.getChangedFacts().size).toBe(0);
  });
});
