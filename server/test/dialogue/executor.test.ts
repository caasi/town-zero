import { describe, it, expect } from "vitest";
import { executeEffects, type MutableContext } from "../../src/dialogue/executor.js";
import type { Effect, Fact, Value, TriggerRule, ResourceType } from "@town-zero/shared";

function makeMutableCtx(): {
  ctx: MutableContext;
  facts: Map<string, Map<string, Fact>>;
  localStore: Map<string, Value>;
  items: Map<string, Map<string, number>>;
  damages: Array<{ ref: string; amount: number }>;
  triggers: TriggerRule[];
} {
  const facts = new Map<string, Map<string, Fact>>();
  const localStore = new Map<string, Value>();
  const items = new Map<string, Map<string, number>>([
    ["$player", new Map([["food", 10], ["material", 5], ["currency", 0]])],
    ["$npc", new Map([["food", 3], ["material", 0], ["currency", 0]])],
  ]);
  const damages: Array<{ ref: string; amount: number }> = [];
  const triggers: TriggerRule[] = [];

  const ctx: MutableContext = {
    beliefs: new Map(),
    locals: localStore,
    agentState: {
      player: { get: (prop) => items.get("$player")?.get(prop) ?? 0 },
      npc: { get: (prop) => items.get("$npc")?.get(prop) ?? 0 },
      settlement: null,
    },
    currentTick: 10,
    npcId: "npc_a",
    setFact(ref, key, value) {
      if (!facts.has(ref)) facts.set(ref, new Map());
      facts.get(ref)!.set(key, { key, value, tick: 10, source: "npc_a" });
    },
    setLocal(key, value) {
      localStore.set(key, value);
    },
    giveItem(ref, item, amount) {
      const inv = items.get(ref);
      if (inv) inv.set(item, (inv.get(item) ?? 0) + amount);
    },
    takeItem(ref, item, amount) {
      const inv = items.get(ref);
      if (!inv) return false;
      const current = inv.get(item) ?? 0;
      if (current < amount) return false;
      inv.set(item, current - amount);
      return true;
    },
    damage(ref, amount) {
      damages.push({ ref, amount });
    },
    registerTrigger(rule) {
      triggers.push(rule);
    },
  };

  return { ctx, facts, localStore, items, damages, triggers };
}

describe("executeEffects()", () => {
  it("executes set_fact", () => {
    const { ctx, facts } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "set_fact", target: "$npc", key: "quest", value: { type: "literal", value: true } },
    ];
    executeEffects(effects, ctx);
    expect(facts.get("$npc")?.get("quest")?.value).toBe(true);
  });

  it("executes set_local", () => {
    const { ctx, localStore } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "set_local", key: "x", value: { type: "literal", value: 42 } },
    ];
    executeEffects(effects, ctx);
    expect(localStore.get("x")).toBe(42);
  });

  it("executes give_item", () => {
    const { ctx, items } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "give_item", target: "$player", item: "food", amount: { type: "literal", value: 3 } },
    ];
    executeEffects(effects, ctx);
    expect(items.get("$player")?.get("food")).toBe(13);
  });

  it("executes take_item", () => {
    const { ctx, items } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "take_item", target: "$player", item: "material", amount: { type: "literal", value: 3 } },
    ];
    executeEffects(effects, ctx);
    expect(items.get("$player")?.get("material")).toBe(2);
  });

  it("short-circuits on take_item failure", () => {
    const { ctx, facts } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "take_item", target: "$player", item: "material", amount: { type: "literal", value: 100 } },
      { type: "set_fact", target: "$npc", key: "should_not_run", value: { type: "literal", value: true } },
    ];
    executeEffects(effects, ctx);
    expect(facts.get("$npc")?.has("should_not_run")).toBeFalsy();
  });

  it("executes damage", () => {
    const { ctx, damages } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "damage", target: "$player", amount: { type: "literal", value: 10 } },
    ];
    executeEffects(effects, ctx);
    expect(damages).toEqual([{ ref: "$player", amount: 10 }]);
  });

  it("executes register_trigger", () => {
    const { ctx, triggers } = makeMutableCtx();
    const rule: TriggerRule = {
      id: "rt:10:0",
      when: { type: "fact_ref", key: "x" },
      then: [],
      targets: ["$npc"],
      once: true,
      source: "runtime",
      fired: false,
    };
    const effects: Effect[] = [
      { type: "register_trigger", trigger: rule },
    ];
    executeEffects(effects, ctx);
    expect(triggers).toHaveLength(1);
  });

  it("throws on unknown effect type", () => {
    const { ctx } = makeMutableCtx();
    const effects = [
      { type: "unknown_effect" } as unknown as Effect,
    ];
    expect(() => executeEffects(effects, ctx)).toThrow("Unknown effect type: unknown_effect");
  });
});
