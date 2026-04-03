import { describe, it, expect } from "vitest";
import { evaluate, checkCondition, interpolate, normalizeTemplateKey, resolveLocale } from "../../src/dialogue/evaluator.js";
import type { Expr, Fact, Value, TextTemplate } from "@town-zero/shared";

function makeCtx(overrides: {
  beliefs?: Record<string, Fact>;
  locals?: Record<string, Value>;
  playerInventory?: { food: number; material: number; currency: number };
  npcInventory?: { food: number; material: number; currency: number };
  npcHp?: number;
  tick?: number;
} = {}) {
  const beliefs = new Map(Object.entries(overrides.beliefs ?? {}));
  const locals = new Map(Object.entries(overrides.locals ?? {}));
  return {
    beliefs,
    locals,
    agentState: {
      player: {
        get(prop: string): Value {
          const inv = overrides.playerInventory ?? { food: 0, material: 0, currency: 0 };
          if (prop in inv) return (inv as Record<string, number>)[prop];
          return 0;
        },
      },
      npc: {
        get(prop: string): Value {
          if (prop === "hp") return overrides.npcHp ?? 100;
          const inv = overrides.npcInventory ?? { food: 0, material: 0, currency: 0 };
          if (prop in inv) return (inv as Record<string, number>)[prop];
          return 0;
        },
      },
      settlement: null,
    },
    currentTick: overrides.tick ?? 1,
  };
}

describe("evaluate()", () => {
  it("literal returns value", () => {
    expect(evaluate({ type: "literal", value: 42 }, makeCtx())).toBe(42);
  });

  it("fact_ref reads from beliefs", () => {
    const ctx = makeCtx({ beliefs: { x: { key: "x", value: "hello", tick: 1, source: "a" } } });
    expect(evaluate({ type: "fact_ref", key: "x" }, ctx)).toBe("hello");
  });

  it("fact_ref returns undefined for missing key", () => {
    expect(evaluate({ type: "fact_ref", key: "missing" }, makeCtx())).toBeUndefined();
  });

  it("local_ref reads from locals", () => {
    const ctx = makeCtx({ locals: { cost: 5 } });
    expect(evaluate({ type: "local_ref", key: "cost" }, ctx)).toBe(5);
  });

  it("prop_ref reads from agent accessor", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 0, currency: 0 } });
    expect(evaluate({ type: "prop_ref", target: "player", prop: "food" }, ctx)).toBe(10);
  });

  it("compare eq", () => {
    expect(evaluate({
      type: "compare", op: "eq",
      left: { type: "literal", value: 5 },
      right: { type: "literal", value: 5 },
    }, makeCtx())).toBe(true);
  });

  it("compare neq", () => {
    expect(evaluate({
      type: "compare", op: "neq",
      left: { type: "literal", value: "a" },
      right: { type: "literal", value: "b" },
    }, makeCtx())).toBe(true);
  });

  it("compare gt", () => {
    expect(evaluate({
      type: "compare", op: "gt",
      left: { type: "literal", value: 10 },
      right: { type: "literal", value: 5 },
    }, makeCtx())).toBe(true);
  });

  it("arithmetic add", () => {
    expect(evaluate({
      type: "arithmetic", op: "add",
      left: { type: "literal", value: 3 },
      right: { type: "literal", value: 4 },
    }, makeCtx())).toBe(7);
  });

  it("logic and", () => {
    expect(evaluate({
      type: "logic", op: "and",
      args: [{ type: "literal", value: true }, { type: "literal", value: false }],
    }, makeCtx())).toBe(false);
  });

  it("logic or", () => {
    expect(evaluate({
      type: "logic", op: "or",
      args: [{ type: "literal", value: false }, { type: "literal", value: true }],
    }, makeCtx())).toBe(true);
  });

  it("logic not", () => {
    expect(evaluate({
      type: "logic", op: "not",
      args: [{ type: "literal", value: true }],
    }, makeCtx())).toBe(false);
  });

  it("call has_item", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 0, currency: 0 } });
    expect(evaluate({
      type: "call", fn: "has_item",
      args: [
        { type: "literal", value: "$player" },
        { type: "literal", value: "food" },
        { type: "literal", value: 5 },
      ],
    }, ctx)).toBe(true);
  });

  it("call count_item", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 3, currency: 0 } });
    expect(evaluate({
      type: "call", fn: "count_item",
      args: [
        { type: "literal", value: "$player" },
        { type: "literal", value: "material" },
      ],
    }, ctx)).toBe(3);
  });

  it("throws on unknown expression type", () => {
    expect(() => evaluate({ type: "bogus" } as unknown as Expr, makeCtx())).toThrow("Unknown expression type");
  });

  it("throws on unknown agent reference in has_item", () => {
    expect(() => evaluate({
      type: "call", fn: "has_item",
      args: [
        { type: "literal", value: "$bogus" },
        { type: "literal", value: "food" },
        { type: "literal", value: 1 },
      ],
    }, makeCtx())).toThrow('Unknown agent reference: "$bogus"');
  });

  it("throws when settlement is null in prop_ref", () => {
    expect(() => evaluate(
      { type: "prop_ref", target: "settlement", prop: "food" },
      makeCtx(),
    )).toThrow("No settlement available");
  });
});

describe("checkCondition()", () => {
  it("returns true for truthy value", () => {
    expect(checkCondition({ type: "literal", value: true }, makeCtx())).toBe(true);
    expect(checkCondition({ type: "literal", value: 1 }, makeCtx())).toBe(true);
  });

  it("returns false for falsy value", () => {
    expect(checkCondition({ type: "literal", value: false }, makeCtx())).toBe(false);
    expect(checkCondition({ type: "literal", value: 0 }, makeCtx())).toBe(false);
    expect(checkCondition({ type: "literal", value: "" }, makeCtx())).toBe(false);
  });
});

describe("interpolate()", () => {
  it("joins strings and evaluated expressions", () => {
    const tpl: TextTemplate = ["Hello ", { type: "fact_ref", key: "name" }, "!"];
    const ctx = makeCtx({ beliefs: { name: { key: "name", value: "Marcus", tick: 1, source: "a" } } });
    expect(interpolate(tpl, ctx)).toBe("Hello Marcus!");
  });

  it("plain string template", () => {
    expect(interpolate(["Hello world"], makeCtx())).toBe("Hello world");
  });
});

describe("normalizeTemplateKey()", () => {
  it("replaces Expr nodes with {0}, {1}", () => {
    const tpl: TextTemplate = ["Hello ", { type: "fact_ref", key: "name" }, " at ", { type: "literal", value: 5 }];
    expect(normalizeTemplateKey(tpl)).toBe("Hello {0} at {1}");
  });

  it("pure string returns as-is", () => {
    expect(normalizeTemplateKey(["Hello world"])).toBe("Hello world");
  });
});

describe("resolveLocale()", () => {
  it("returns original template when locale is undefined", () => {
    const tpl: TextTemplate = ["Hello ", { type: "fact_ref", key: "name" }];
    expect(resolveLocale(tpl, undefined)).toBe(tpl);
  });

  it("returns original template when key is not found in locale", () => {
    const tpl: TextTemplate = ["Goodbye"];
    const locale = { "Hello {0}": "こんにちは{0}" };
    expect(resolveLocale(tpl, locale)).toBe(tpl);
  });

  it("translates a pure string template", () => {
    const tpl: TextTemplate = ["Hello world"];
    const locale = { "Hello world": "こんにちは世界" };
    expect(resolveLocale(tpl, locale)).toEqual(["こんにちは世界"]);
  });

  it("translates and re-inserts expression placeholders", () => {
    const nameExpr: Expr = { type: "fact_ref", key: "name" };
    const tpl: TextTemplate = ["Hello ", nameExpr, "!"];
    const locale = { "Hello {0}!": "こんにちは{0}さん！" };
    const result = resolveLocale(tpl, locale);
    expect(result).toEqual(["こんにちは", nameExpr, "さん！"]);
  });

  it("supports @@context suffix for disambiguation", () => {
    const tpl: TextTemplate = ["Open"];
    const locale = { "Open@@door": "開ける", "Open@@window": "開く" };
    expect(resolveLocale(tpl, locale, "door")).toEqual(["開ける"]);
    expect(resolveLocale(tpl, locale, "window")).toEqual(["開く"]);
  });

  it("handles out-of-range placeholder index gracefully", () => {
    const nameExpr: Expr = { type: "fact_ref", key: "name" };
    const tpl: TextTemplate = ["Hi ", nameExpr];
    // Translation references {0} and {5} — {5} is out of range and should be omitted
    const locale = { "Hi {0}": "{0}こんにちは{5}" };
    const result = resolveLocale(tpl, locale);
    expect(result).toEqual([nameExpr, "こんにちは"]);
  });

  it("filters empty strings from translated result", () => {
    const nameExpr: Expr = { type: "fact_ref", key: "name" };
    const tpl: TextTemplate = ["Hello ", nameExpr];
    // Translation starts with a placeholder — leading empty string is filtered
    const locale = { "Hello {0}": "{0}!" };
    const result = resolveLocale(tpl, locale);
    expect(result).toEqual([nameExpr, "!"]);
  });
});
