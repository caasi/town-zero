import type { Effect } from "@town-zero/shared";
import type { NpcEventMap, NpcEventName } from "@town-zero/shared/script-dsl";
import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";

export function dispatch<K extends NpcEventName>(
  agent: Agent,
  event: K,
  payload: NpcEventMap[K],
): Effect[] {
  const handlers = agent.eventHandlers.get(event);
  if (!handlers || handlers.length === 0) return [];
  const snapshot = [...handlers];
  const out: Effect[] = [];
  for (let i = 0; i < snapshot.length; i++) {
    try {
      const effects = snapshot[i](payload as unknown);
      if (effects.length > 0) out.push(...effects);
    } catch (err) {
      console.error(`[event-dispatch] ${agent.id} ${event} handler ${i} threw:`, err);
    }
  }
  return out;
}

export function applyEventEffects(effects: Effect[], state: SimulationState): void {
  for (const effect of effects) {
    switch (effect.type) {
      case "bubble": {
        const target = state.agents.get(effect.target);
        if (!target) break;
        target.setBubble(effect.text, effect.durationTicks, state.tick);
        break;
      }
      default:
        console.warn(`[event-dispatch] unsupported effect type "${effect.type}" in event handler`);
    }
  }
}
