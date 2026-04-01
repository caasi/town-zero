import { GATHER_DURATION, ATTACK_COOLDOWN_TICKS, MERCHANT_SPAWN_INTERVAL } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { validateCommand, executeCommand } from "./commands.js";
import { processGathering, processProduction, processConsumption } from "./resources.js";
import { processCombat } from "./combat.js";
import { updateVision, mergeAdjacentMemories } from "./vision.js";
import { decideBotAction } from "../ai/bot-controller.js";

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
      const target = agent.currentTargetId ? agents.get(agent.currentTargetId) : undefined;
      if (target && target.isAlive()) {
        processCombat(agent, target);
      } else {
        agent.state = "idle";
        agent.currentCommandTicks = 0;
        agent.currentCommandTarget = 0;
        agent.currentTargetId = null;
      }
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
            agent.currentTargetId = cmd.targetId;
            processCombat(agent, target);
          }
          break;
        }
        case "talk":
          break;
      }
    }
  }

  // Phase 2.5: Bot controller for idle bot agents
  for (const [, agent] of agents) {
    if (!agent.isAlive() || agent.controller !== "bot") continue;
    if (agent.state !== "idle" || agent.plan.length > 0) continue;
    if (agent.role === "merchant") continue; // merchants have their own logic

    const settlement = Array.from(settlements.values()).find((s) =>
      s.populationIds.includes(agent.id),
    );
    if (settlement) {
      const cmd = decideBotAction(agent, settlement);
      agent.setPlan([cmd]);
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
