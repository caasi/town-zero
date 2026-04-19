import type { Expr, Value } from "../script-types.js";

export type ExprOrValue = ExprBuilder | Value;

export function toExpr(v: ExprOrValue): Expr {
  if (v instanceof ExprBuilder) return v.toExpr();
  return { type: "literal", value: v };
}

export class ExprBuilder {
  constructor(private readonly expr: Expr) {}

  toExpr(): Expr {
    return this.expr;
  }

  // --- Comparison ---
  eq(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "eq", left: this.expr, right: toExpr(other) });
  }
  neq(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "neq", left: this.expr, right: toExpr(other) });
  }
  gt(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "gt", left: this.expr, right: toExpr(other) });
  }
  lt(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "lt", left: this.expr, right: toExpr(other) });
  }
  gte(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "gte", left: this.expr, right: toExpr(other) });
  }
  lte(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "lte", left: this.expr, right: toExpr(other) });
  }

  // --- Arithmetic ---
  add(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "add", left: this.expr, right: toExpr(other) });
  }
  sub(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "sub", left: this.expr, right: toExpr(other) });
  }
  mul(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "mul", left: this.expr, right: toExpr(other) });
  }
  div(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "div", left: this.expr, right: toExpr(other) });
  }

  // --- Logic ---
  and(other: ExprBuilder): ExprBuilder {
    return new ExprBuilder({ type: "logic", op: "and", args: [this.expr, other.toExpr()] });
  }
  or(other: ExprBuilder): ExprBuilder {
    return new ExprBuilder({ type: "logic", op: "or", args: [this.expr, other.toExpr()] });
  }
}

// --- Factory functions ---

export function not(expr: ExprBuilder): ExprBuilder {
  return new ExprBuilder({ type: "logic", op: "not", args: [expr.toExpr()] });
}

export function literal(value: Value): ExprBuilder {
  return new ExprBuilder({ type: "literal", value });
}

export function fact(key: string): ExprBuilder {
  return new ExprBuilder({ type: "fact_ref", key });
}

export function local(key: string): ExprBuilder {
  return new ExprBuilder({ type: "local_ref", key });
}

// --- Agent proxies ---

interface AgentProxy {
  prop(name: string): ExprBuilder;
  hasItem(item: string, amount: ExprOrValue): ExprBuilder;
}

function createAgentProxy(target: "player" | "npc" | "settlement", refString: string): AgentProxy {
  return {
    prop(name: string): ExprBuilder {
      return new ExprBuilder({ type: "prop_ref", target, prop: name });
    },
    hasItem(item: string, amount: ExprOrValue): ExprBuilder {
      return new ExprBuilder({
        type: "call",
        fn: "has_item",
        args: [
          { type: "literal", value: refString },
          { type: "literal", value: item },
          toExpr(amount),
        ],
      });
    },
  };
}

export const player: AgentProxy = createAgentProxy("player", "$player");
export const npc: AgentProxy = createAgentProxy("npc", "$npc");
export const settlement: AgentProxy = createAgentProxy("settlement", "$settlement");
