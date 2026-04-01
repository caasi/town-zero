import { BASE_ATTACK_DAMAGE, ATTACK_COOLDOWN_TICKS } from "@town-zero/shared";
import type { Agent } from "./agent.js";

export function processCombat(attacker: Agent, target: Agent): void {
  if (attacker.state !== "fighting") return;
  if (!target.isAlive()) {
    attacker.state = "idle";
    attacker.currentCommandTicks = 0;
    attacker.currentCommandTarget = 0;
    attacker.currentTargetId = null;
    return;
  }

  target.takeDamage(BASE_ATTACK_DAMAGE);

  attacker.currentCommandTicks++;
  if (attacker.currentCommandTicks >= ATTACK_COOLDOWN_TICKS) {
    attacker.state = "idle";
    attacker.currentCommandTicks = 0;
    attacker.currentCommandTarget = 0;
    attacker.currentTargetId = null;
  }
}
