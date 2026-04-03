import type { Expr, Fact, TriggerRule } from "@town-zero/shared";
import { checkCondition, type EvalContext } from "./evaluator.js";

export interface FiredTrigger {
  rule: TriggerRule;
  targets: string[];
}

/** Extract all fact_ref keys referenced in an expression (for change-tracking). */
function extractFactKeys(expr: Expr): Set<string> {
  const keys = new Set<string>();
  function walk(e: Expr): void {
    if (e.type === "fact_ref") {
      keys.add(e.key);
    } else if (e.type === "compare" || e.type === "arithmetic") {
      walk(e.left);
      walk(e.right);
    } else if (e.type === "logic") {
      for (const arg of e.args) walk(arg);
    } else if (e.type === "call") {
      for (const arg of e.args) walk(arg);
    }
  }
  walk(expr);
  return keys;
}

export class TriggerRegistry {
  private rules: TriggerRule[] = [];
  private changedFacts: Set<string> = new Set();
  private ruleFactKeys: Map<string, Set<string>> = new Map();

  register(rule: TriggerRule): void {
    if (this.ruleFactKeys.has(rule.id)) {
      throw new Error(`Duplicate trigger rule id: "${rule.id}"`);
    }
    this.rules.push(rule);
    this.ruleFactKeys.set(rule.id, extractFactKeys(rule.when));
  }

  getAll(): TriggerRule[] {
    return this.rules;
  }

  recordChangedFact(key: string): void {
    this.changedFacts.add(key);
  }

  getChangedFacts(): Set<string> {
    return this.changedFacts;
  }

  clearChangedFacts(): void {
    this.changedFacts.clear();
  }

  evaluateBatch(beliefs: ReadonlyMap<string, Fact>, currentTick: number): FiredTrigger[] {
    const fired: FiredTrigger[] = [];

    for (const rule of this.rules) {
      if (rule.once && rule.fired) continue;

      const deps = this.ruleFactKeys.get(rule.id);
      if (!deps) continue;
      let relevant = false;
      for (const key of this.changedFacts) {
        if (deps.has(key)) { relevant = true; break; }
      }
      if (!relevant) continue;

      const ctx: EvalContext = {
        beliefs,
        locals: new Map(),
        agentState: {
          player: { get: () => 0 },
          npc: { get: () => 0 },
          settlement: null,
        },
        currentTick,
      };

      if (checkCondition(rule.when, ctx)) {
        if (rule.once) rule.fired = true;
        fired.push({ rule, targets: [...rule.targets] });
      }
    }

    return fired;
  }
}
