import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";
import { dispatch, applyEventEffects } from "./event-dispatch.js";

export function applyDamage(
  target: Agent,
  amount: number,
  attacker: Agent | null,
  state: SimulationState,
): void {
  if (!target.isAlive()) return;
  const hpBefore = target.hp;
  target.takeDamage(amount);
  const actualDamage = Math.min(amount, hpBefore);

  const selfRef = { id: target.id, faction: target.faction, role: target.role, position: { ...target.position } };
  const attackerRef = attacker
    ? { id: attacker.id, faction: attacker.faction, role: attacker.role, position: { ...attacker.position } }
    : null;

  if (attackerRef) {
    const hitEffs = dispatch(target, "combat:hit", {
      tick: state.tick, self: selfRef, attacker: attackerRef, damage: actualDamage, hpAfter: target.hp,
    });
    applyEventEffects(hitEffs, state);
  }

  if (!target.isAlive()) {
    const deathEffs = dispatch(target, "combat:death", {
      tick: state.tick, self: selfRef, killer: attackerRef,
    });
    applyEventEffects(deathEffs, state);
  }
}
