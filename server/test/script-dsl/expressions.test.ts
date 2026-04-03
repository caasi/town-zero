import { describe, it, expect } from "vitest";
import { fact, local, player, npc, settlement, not } from "@town-zero/shared/script-dsl";

describe("ExprBuilder", () => {
  it("fact() creates a fact_ref node", () => {
    expect(fact("trust").toExpr()).toEqual({ type: "fact_ref", key: "trust" });
  });

  it("fact().eq(5) produces compare node", () => {
    expect(fact("trust").eq(5).toExpr()).toEqual({
      type: "compare",
      op: "eq",
      left: { type: "fact_ref", key: "trust" },
      right: { type: "literal", value: 5 },
    });
  });

  it("fact().neq('intact') with string", () => {
    expect(fact("wall_state").neq("intact").toExpr()).toEqual({
      type: "compare",
      op: "neq",
      left: { type: "fact_ref", key: "wall_state" },
      right: { type: "literal", value: "intact" },
    });
  });

  it("fact().gt(3) works", () => {
    expect(fact("trust").gt(3).toExpr()).toEqual({
      type: "compare",
      op: "gt",
      left: { type: "fact_ref", key: "trust" },
      right: { type: "literal", value: 3 },
    });
  });

  it("fact().add(5) produces arithmetic node", () => {
    expect(fact("trust").add(5).toExpr()).toEqual({
      type: "arithmetic",
      op: "add",
      left: { type: "fact_ref", key: "trust" },
      right: { type: "literal", value: 5 },
    });
  });

  it("fact().eq(1).and(fact().eq(2)) produces logic node", () => {
    const expr = fact("a").eq(1).and(fact("b").eq(2));
    expect(expr.toExpr()).toEqual({
      type: "logic",
      op: "and",
      args: [
        { type: "compare", op: "eq", left: { type: "fact_ref", key: "a" }, right: { type: "literal", value: 1 } },
        { type: "compare", op: "eq", left: { type: "fact_ref", key: "b" }, right: { type: "literal", value: 2 } },
      ],
    });
  });

  it("local() creates local_ref node", () => {
    expect(local("counter").toExpr()).toEqual({ type: "local_ref", key: "counter" });
  });

  it("player.prop('food') creates prop_ref", () => {
    expect(player.prop("food").toExpr()).toEqual({
      type: "prop_ref",
      target: "player",
      prop: "food",
    });
  });

  it("player.hasItem('material', local('cost')) creates call node", () => {
    expect(player.hasItem("material", local("cost")).toExpr()).toEqual({
      type: "call",
      fn: "has_item",
      args: [
        { type: "literal", value: "$player" },
        { type: "literal", value: "material" },
        { type: "local_ref", key: "cost" },
      ],
    });
  });

  it("npc.prop('hp') creates prop_ref with target npc", () => {
    expect(npc.prop("hp").toExpr()).toEqual({
      type: "prop_ref",
      target: "npc",
      prop: "hp",
    });
  });

  it("settlement.prop('food') creates prop_ref", () => {
    expect(settlement.prop("food").toExpr()).toEqual({
      type: "prop_ref",
      target: "settlement",
      prop: "food",
    });
  });

  it("fact('a').gt(fact('b')) comparison with ExprBuilder rhs", () => {
    expect(fact("a").gt(fact("b")).toExpr()).toEqual({
      type: "compare",
      op: "gt",
      left: { type: "fact_ref", key: "a" },
      right: { type: "fact_ref", key: "b" },
    });
  });

  it("not() produces logic not node", () => {
    expect(not(fact("x").eq(true)).toExpr()).toEqual({
      type: "logic",
      op: "not",
      args: [{ type: "compare", op: "eq", left: { type: "fact_ref", key: "x" }, right: { type: "literal", value: true } }],
    });
  });

  it("not() composes with and/or", () => {
    const expr = not(fact("a")).and(fact("b").eq(1));
    expect(expr.toExpr().type).toBe("logic");
  });
});
