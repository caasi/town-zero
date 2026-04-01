import { GATHER_DURATION, ATTACK_COOLDOWN_TICKS, MERCHANT_SPAWN_INTERVAL, MERCHANT_TRADE_RATE } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { validateCommand, executeCommand } from "./commands.js";
import { processGathering, processProduction, processConsumption } from "./resources.js";
import { processCombat } from "./combat.js";
import { updateVision, mergeAdjacentMemories } from "./vision.js";

export interface SimulationState {
  grid: Grid;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  tick: number;
  nextMerchantId: number;
}

export function spawnMerchant(state: SimulationState): void {
  const id = `merchant-${state.nextMerchantId++}`;
  const merchant = new Agent({
    id,
    position: { x: 0, y: Math.floor(state.grid.height / 2) },
    faction: "merchant",
    role: "merchant",
    controller: "bot",
  });
  merchant.addToInventory("currency", 10);
  state.agents.set(id, merchant);
}

export function processMerchantTick(merchant: Agent, state: SimulationState): void {
  if (merchant.role !== "merchant") return;

  for (const [, settlement] of state.settlements) {
    if (settlement.type === "village" && settlement.isInTerritory(merchant.position)) {
      const tradeAmount = Math.min(merchant.inventory.currency, 3);
      if (tradeAmount > 0 && (settlement.inventory.food > 0 || settlement.inventory.material > 0)) {
        const foodToTake = Math.min(tradeAmount * MERCHANT_TRADE_RATE, settlement.inventory.food);
        if (foodToTake > 0) {
          settlement.removeResource("food", foodToTake);
          merchant.addToInventory("food", foodToTake);
          const currencyPaid = Math.ceil(foodToTake / MERCHANT_TRADE_RATE);
          merchant.removeFromInventory("currency", currencyPaid);
          settlement.addResource("currency", currencyPaid);
        }
      }
      merchant.position = { x: merchant.position.x - 1, y: merchant.position.y };
      return;
    }
  }

  const nextX = merchant.position.x + 1;
  if (state.grid.inBounds(nextX, merchant.position.y)) {
    merchant.position = { x: nextX, y: merchant.position.y };
  } else {
    state.agents.delete(merchant.id);
  }
}

export function processTick(state: SimulationState): void {
  state.tick++;

  const { grid, agents, settlements, tick } = state;

  // Phase 1: Process ongoing actions (gathering, fighting)
  for (const [, agent] of agents) {
    if (!agent.isAlive()) continue;

    if (agent.state === "gathering") {
      processGathering(agent, grid);
      continue;
    }

    if (agent.state === "fighting") {
      continue;
    }

    // Phase 2: If idle, dequeue next command
    if (agent.state === "idle" && agent.plan.length > 0) {
      const cmd = agent.shiftPlan()!;
      const ctx = { grid, agent, agents, settlements };

      if (!validateCommand(cmd, ctx)) {
        continue;
      }

      switch (cmd.type) {
        case "move":
        case "deposit":
        case "take":
        case "trade":
        case "idle":
          executeCommand(cmd, ctx);
          break;
        case "gather":
          agent.state = "gathering";
          agent.currentCommandTicks = 0;
          agent.currentCommandTarget = GATHER_DURATION;
          break;
        case "attack": {
          const target = agents.get(cmd.targetId);
          if (target && target.isAlive()) {
            agent.state = "fighting";
            agent.currentCommandTicks = 0;
            agent.currentCommandTarget = ATTACK_COOLDOWN_TICKS;
            processCombat(agent, target);
          }
          break;
        }
        case "talk":
          break;
      }
    }
  }

  // Phase 3: Production
  for (const [, settlement] of settlements) {
    processProduction(settlement, agents, tick);
  }

  // Phase 4: Consumption
  for (const [, agent] of agents) {
    processConsumption(agent, tick);
  }

  // Phase 5: Merchant spawning and movement
  if (tick % MERCHANT_SPAWN_INTERVAL === 0 && tick > 0) {
    spawnMerchant(state);
  }
  for (const [, agent] of agents) {
    if (agent.role === "merchant") {
      processMerchantTick(agent, state);
    }
  }

  // Phase 6: Vision update
  for (const [, agent] of agents) {
    updateVision(agent, grid, agents, tick);
  }

  // Phase 7: Memory merge for adjacent same-faction agents
  const agentList = Array.from(agents.values()).filter((a) => a.isAlive());
  mergeAdjacentMemories(agentList, grid);
}
