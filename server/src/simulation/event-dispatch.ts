import type { EventEffect, NpcEventMap, NpcEventName } from "@town-zero/shared/script-dsl";
import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";

// Resolve special AgentRef prefixes against the event payload. Handlers in
// scenarios often write `bubble(self.id, …)` directly, but code written against
// the generic AgentRef convention may use "$npc" / "$self" / "$player". Without
// resolution those would miss `state.agents.get(ref)` and silently no-op.
function resolveAgentRef(ref: string, self: Agent, payload: unknown): string {
  if (!ref.startsWith("$")) return ref;
  if (ref === "$npc" || ref === "$self") return self.id;
  if (ref === "$player") {
    const p = (payload as { player?: { id: string } }).player;
    if (p?.id) return p.id;
  }
  // "$faction:xxx" (and any unknown prefix) is returned unchanged — caller
  // will warn when the lookup fails.
  return ref;
}

function resolveEffectRefs(
  effects: EventEffect[],
  self: Agent,
  payload: unknown,
): EventEffect[] {
  return effects.map((eff) => {
    switch (eff.type) {
      case "bubble":
        return { ...eff, target: resolveAgentRef(eff.target, self, payload) };
      default: {
        const _exhaustive: never = eff.type;
        void _exhaustive;
        return eff;
      }
    }
  });
}

export function dispatch<K extends NpcEventName>(
  agent: Agent,
  event: K,
  payload: NpcEventMap[K],
): EventEffect[] {
  const handlers = agent.eventHandlers.get(event);
  if (!handlers || handlers.length === 0) return [];
  const snapshot = [...handlers];
  const out: EventEffect[] = [];
  for (let i = 0; i < snapshot.length; i++) {
    try {
      const effects = snapshot[i](payload as unknown) as EventEffect[];
      if (effects.length > 0) out.push(...effects);
    } catch (err) {
      console.error(`[event-dispatch] ${agent.id} ${event} handler ${i} threw:`, err);
    }
  }
  return resolveEffectRefs(out, agent, payload);
}

export function applyEventEffects(effects: EventEffect[], state: SimulationState): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "bubble": {
        const target = state.agents.get(effect.target);
        if (!target) {
          console.warn(`[event-dispatch] bubble target "${effect.target}" not found`);
          break;
        }
        target.setBubble(effect.text, effect.durationTicks, state.tick);
        break;
      }
      default: {
        const _exhaustive: never = effect.type;
        void _exhaustive;
      }
    }
  }
}
