import type { Effect, Value, TriggerRule, ResourceType } from "@town-zero/shared";
import { evaluate, type EvalContext } from "./evaluator.js";

export interface MutableContext extends EvalContext {
  npcId: string;
  setFact(ref: string, key: string, value: Value): void;
  setLocal(key: string, value: Value): void;
  giveItem(ref: string, item: ResourceType, amount: number): void;
  takeItem(ref: string, item: ResourceType, amount: number): boolean;
  damage(ref: string, amount: number): void;
  registerTrigger(rule: TriggerRule): void;
}

type EffectHandler = (effect: Effect, ctx: MutableContext) => boolean; // false = short-circuit

const effectHandlers: Record<string, EffectHandler> = {
  set_fact(effect, ctx) {
    if (effect.type !== "set_fact") return true;
    const value = evaluate(effect.value, ctx);
    if (value === undefined) throw new Error(`set_fact: value for key "${effect.key}" evaluated to undefined`);
    ctx.setFact(effect.target, effect.key, value);
    return true;
  },

  set_local(effect, ctx) {
    if (effect.type !== "set_local") return true;
    const value = evaluate(effect.value, ctx);
    if (value === undefined) throw new Error(`set_local: value for key "${effect.key}" evaluated to undefined`);
    ctx.setLocal(effect.key, value);
    return true;
  },

  give_item(effect, ctx) {
    if (effect.type !== "give_item") return true;
    const amount = evaluate(effect.amount, ctx);
    if (typeof amount !== "number") throw new Error(`give_item: amount evaluated to ${typeof amount}, expected number`);
    ctx.giveItem(effect.target, effect.item, amount);
    return true;
  },

  take_item(effect, ctx) {
    if (effect.type !== "take_item") return true;
    const amount = evaluate(effect.amount, ctx);
    if (typeof amount !== "number") throw new Error(`take_item: amount evaluated to ${typeof amount}, expected number`);
    return ctx.takeItem(effect.target, effect.item, amount);
  },

  damage(effect, ctx) {
    if (effect.type !== "damage") return true;
    const amount = evaluate(effect.amount, ctx);
    if (typeof amount !== "number") throw new Error(`damage: amount evaluated to ${typeof amount}, expected number`);
    ctx.damage(effect.target, amount);
    return true;
  },

  register_trigger(effect, ctx) {
    if (effect.type !== "register_trigger") return true;
    ctx.registerTrigger(effect.trigger);
    return true;
  },
};

export function executeEffects(effects: Effect[], ctx: MutableContext): void {
  for (const effect of effects) {
    const handler = effectHandlers[effect.type];
    if (!handler) throw new Error(`Unknown effect type: ${effect.type}`);
    const continueExecution = handler(effect, ctx);
    if (!continueExecution) break;
  }
}
