import {
  FOOD_CONSUMPTION_INTERVAL,
  STARVATION_DAMAGE,
  PRODUCTION_INPUT_COST,
  PRODUCTION_OUTPUT,
  PRODUCTION_CYCLE_TICKS,
} from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";

export function processGathering(agent: Agent, grid: Grid): void {
  if (agent.state !== "gathering") return;

  agent.currentCommandTicks++;
  if (agent.currentCommandTicks >= agent.currentCommandTarget) {
    const tile = agent.gatherTile ?? agent.position;
    const resource = grid.getResourceYield(tile.x, tile.y);
    if (resource) {
      agent.addToInventory(resource, 1);
    }
    agent.state = "idle";
    agent.currentCommandTicks = 0;
    agent.currentCommandTarget = 0;
    agent.gatherTile = null;
  }
}

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
    agent.takeDamage(STARVATION_DAMAGE);
  }
}
