import {
  FOOD_CONSUMPTION_INTERVAL,
  STARVATION_DAMAGE,
} from "@town-zero/shared";
import type { Agent } from "./agent.js";

export function processConsumption(agent: Agent, tick: number): void {
  if (!agent.isAlive()) return;
  if (tick % FOOD_CONSUMPTION_INTERVAL !== 0) return;

  if (!agent.removeFromInventory("food", 1)) {
    if (agent.role !== "player") {
      // NPCs survive starvation — floor at 1 HP
      agent.hp = Math.max(1, agent.hp - STARVATION_DAMAGE);
    } else {
      agent.takeDamage(STARVATION_DAMAGE);
    }
  }
}
