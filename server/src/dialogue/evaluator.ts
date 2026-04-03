import type { Expr, Value, TextTemplate, Fact } from "@town-zero/shared";

// --- Agent Accessor interface ---

export interface AgentAccessor {
  get(prop: string): Value;
}

export interface SettlementAccessor {
  get(prop: string): Value;
}

// --- Eval Context ---

export interface EvalContext {
  beliefs: ReadonlyMap<string, Fact>;
  locals: ReadonlyMap<string, Value>;
  agentState: {
    player: AgentAccessor;
    npc: AgentAccessor;
    settlement: SettlementAccessor | null;
  };
  currentTick: number;
}

// --- Function Registry ---

type BuiltinFn = (args: Value[], ctx: EvalContext) => Value;

const builtinFunctions: Record<string, BuiltinFn> = {
  has_item(args, ctx) {
    const [targetRef, item, amount] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    const count = accessor.get(String(item));
    return typeof count === "number" && typeof amount === "number" && count >= amount;
  },
  count_item(args, ctx) {
    const [targetRef, item] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    const count = accessor.get(String(item));
    return typeof count === "number" ? count : 0;
  },
  distance(args, ctx) {
    const [aRef, bRef] = args;
    const aAccessor = resolveAccessor(String(aRef), ctx);
    const bAccessor = resolveAccessor(String(bRef), ctx);
    const ax = aAccessor.get("x") as number;
    const ay = aAccessor.get("y") as number;
    const bx = bAccessor.get("x") as number;
    const by = bAccessor.get("y") as number;
    return Math.abs(ax - bx) + Math.abs(ay - by);
  },
  faction_of(args, ctx) {
    const [targetRef] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    return accessor.get("faction");
  },
};

function resolveAccessor(ref: string, ctx: EvalContext): AgentAccessor {
  if (ref === "$player") return ctx.agentState.player;
  if (ref === "$npc") return ctx.agentState.npc;
  if (ref === "$settlement") {
    if (!ctx.agentState.settlement) {
      throw new Error(`No settlement available in context (referenced by "${ref}")`);
    }
    return ctx.agentState.settlement;
  }
  throw new Error(`Unknown agent reference: "${ref}"`);
}

// --- Evaluator ---

export function evaluate(expr: Expr, ctx: EvalContext): Value | undefined {
  switch (expr.type) {
    case "literal":
      return expr.value;

    case "fact_ref": {
      const fact = ctx.beliefs.get(expr.key);
      return fact?.value;
    }

    case "local_ref":
      return ctx.locals.get(expr.key);

    case "prop_ref": {
      if (expr.target === "settlement") {
        if (!ctx.agentState.settlement) {
          throw new Error(`No settlement available in context for prop_ref "${expr.prop}"`);
        }
        return ctx.agentState.settlement.get(expr.prop);
      }
      return ctx.agentState[expr.target].get(expr.prop);
    }

    case "compare": {
      const left = evaluate(expr.left, ctx);
      const right = evaluate(expr.right, ctx);
      switch (expr.op) {
        case "eq": return left === right;
        case "neq": return left !== right;
        case "gt": return (left as number) > (right as number);
        case "lt": return (left as number) < (right as number);
        case "gte": return (left as number) >= (right as number);
        case "lte": return (left as number) <= (right as number);
        default: throw new Error(`Unknown compare operator: ${(expr as { op: string }).op}`);
      }
    }

    case "arithmetic": {
      const left = evaluate(expr.left, ctx) as number;
      const right = evaluate(expr.right, ctx) as number;
      switch (expr.op) {
        case "add": return left + right;
        case "sub": return left - right;
        case "mul": return left * right;
        case "div": return right !== 0 ? left / right : 0;
        default: throw new Error(`Unknown arithmetic operator: ${(expr as { op: string }).op}`);
      }
    }

    case "logic": {
      switch (expr.op) {
        case "and": return expr.args.every((a) => !!evaluate(a, ctx));
        case "or": return expr.args.some((a) => !!evaluate(a, ctx));
        case "not": return !evaluate(expr.args[0], ctx);
        default: throw new Error(`Unknown logic operator: ${(expr as { op: string }).op}`);
      }
    }

    case "call": {
      const fn = builtinFunctions[expr.fn];
      if (!fn) throw new Error(`Unknown function: ${expr.fn}`);
      const args: Value[] = expr.args.map((a, index) => {
        const value = evaluate(a, ctx);
        if (value === undefined) {
          throw new Error(`Function "${expr.fn}" argument at index ${index} evaluated to undefined`);
        }
        return value;
      });
      return fn(args, ctx);
    }

    default:
      throw new Error(`Unknown expression type: ${(expr as { type: string }).type}`);
  }
}

// --- Convenience ---

export function checkCondition(expr: Expr, ctx: EvalContext): boolean {
  return !!evaluate(expr, ctx);
}

export function interpolate(template: TextTemplate, ctx: EvalContext): string {
  return template
    .map((part) => (typeof part === "string" ? part : String(evaluate(part, ctx) ?? "")))
    .join("");
}

// --- i18n helpers ---

export function normalizeTemplateKey(template: TextTemplate): string {
  let index = 0;
  return template
    .map((part) => (typeof part === "string" ? part : `{${index++}}`))
    .join("");
}

export function resolveLocale(
  template: TextTemplate,
  locale: Record<string, string> | undefined,
  context?: string,
): TextTemplate {
  if (!locale) return template;
  let key = normalizeTemplateKey(template);
  if (context) key += `@@${context}`;
  const translated = locale[key];
  if (!translated) return template;

  const exprNodes = template.filter((p): p is Expr => typeof p !== "string");
  const result: TextTemplate = [];
  const parts = translated.split(/\{(\d+)\}/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i] !== "") result.push(parts[i]);
    } else {
      const idx = parseInt(parts[i], 10);
      if (idx < exprNodes.length) result.push(exprNodes[idx]);
    }
  }
  return result;
}
