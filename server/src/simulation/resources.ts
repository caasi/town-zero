import {
  FOOD_CONSUMPTION_INTERVAL,
  STARVATION_DAMAGE,
  PRODUCTION_INPUT_COST,
  PRODUCTION_OUTPUT,
  PRODUCTION_CYCLE_TICKS,
} from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Settlement } from "./settlement.js";

export function processProduction(settlement: Settlement, agents: Map<string, Agent>, tick: number): void {
  if (tick % PRODUCTION_CYCLE_TICKS !== 0) return;

  for (const structure of settlement.getProductionStructures()) {
    if (!structure.operatorId) continue;

    const operator = agents.get(structure.operatorId);
    if (!operator || !operator.isAlive()) continue;

    if (settlement.removeResource("material", PRODUCTION_INPUT_COST)) {
      settlement.addResource("food", PRODUCTION_OUTPUT);
    }
  }
}

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
