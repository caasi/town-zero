import { GATHER_DURATION, ATTACK_COOLDOWN_TICKS, MERCHANT_SPAWN_INTERVAL, DIRECTION_DELTA } from "@town-zero/shared";
import type { Fact, Value, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { validateCommand, executeCommand } from "./commands.js";
import { processGathering, processProduction, processConsumption } from "./resources.js";
import { processCombat } from "./combat.js";
import { updateVision, mergeAdjacentMemories } from "./vision.js";
import { decideBotAction } from "../ai/bot-controller.js";
import { TriggerRegistry } from "../dialogue/trigger-registry.js";
import { evaluate } from "../dialogue/evaluator.js";

export interface SimulationState {
  grid: Grid;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  tick: number;
  nextMerchantId: number;
  triggerRegistry?: TriggerRegistry;
  activeSessions: Map<string, import("../dialogue/dialogue-session.js").DialogueSession>;
  dialogueTrees: Map<string, DialogueTreeData>;
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

    // Phase 1.5: Consume one move input from moveQueue (per-tick input model)
    // Yield to plan commands — explicit actions (gather, attack, etc.) take priority
    if (agent.state === "idle" && agent.moveQueue.length > 0 && agent.plan.length === 0) {
      const input = agent.moveQueue.shift()!;
      const delta = DIRECTION_DELTA[input.direction];
      if (delta) {
        const target = { x: agent.position.x + delta.dx, y: agent.position.y + delta.dy };
        const moveCmd = { type: "move" as const, target };
        const ctx = { grid, agent, agents, settlements };
        if (validateCommand(moveCmd, ctx)) {
          executeCommand(moveCmd, ctx);
        }
      }
      agent.lastProcessedInput = Math.max(agent.lastProcessedInput, input.seq);
      continue;
    }

    // Phase 2: If idle, dequeue next command
    if (agent.state === "idle" && agent.plan.length > 0) {
      // Clear stale move inputs — plan commands take priority.
      // Advance lastProcessedInput so discarded inputs are acknowledged
      // and won't be replayed forever by the client.
      if (agent.moveQueue.length > 0) {
        for (const input of agent.moveQueue) {
          agent.lastProcessedInput = Math.max(agent.lastProcessedInput, input.seq);
        }
        agent.moveQueue = [];
      }
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
          agent.gatherTile = { ...cmd.resourceTile };
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

  // Phase 5: Merchant movement and spawning
  for (const [, agent] of agents) {
    if (agent.role === "merchant") {
      processMerchantTick(agent, state);
    }
  }
  if (tick % MERCHANT_SPAWN_INTERVAL === 0 && tick > 0) {
    spawnMerchant(state);
  }

  // Phase 6: Vision update
  for (const [, agent] of agents) {
    updateVision(agent, grid, agents, tick);
  }

  // Phase 7: Memory merge for adjacent same-faction agents
  const agentList = Array.from(agents.values()).filter((a) => a.isAlive());
  mergeAdjacentMemories(agentList, grid);

  // Phase 8: Trigger evaluation (deferred-batch)
  // TODO: allBeliefs merges all agents' beliefs into a global view (newest-tick-wins).
  // This violates the "no global omniscience" principle. Triggers should ideally
  // evaluate against per-target or per-faction beliefs, not a world-wide merge.
  if (state.triggerRegistry) {
    const allBeliefs = new Map<string, Fact>();
    for (const [, agent] of agents) {
      if (!agent.isAlive()) continue;
      for (const [key, fact] of agent.getAllBeliefs()) {
        const existing = allBeliefs.get(key);
        if (!existing || fact.tick > existing.tick) {
          allBeliefs.set(key, fact);
        }
      }
    }

    const fired = state.triggerRegistry.evaluateBatch(allBeliefs, tick);

    for (const { rule, targets } of fired) {
      for (const targetRef of targets) {
        let targetAgents: Agent[] = [];
        if (targetRef.startsWith("$faction:")) {
          const faction = targetRef.slice("$faction:".length);
          targetAgents = Array.from(agents.values()).filter(
            (a) => a.isAlive() && a.faction === faction,
          );
        } else {
          const agent = agents.get(targetRef);
          if (agent?.isAlive()) targetAgents = [agent];
        }

        for (const targetAgent of targetAgents) {
          for (const effect of rule.then) {
            if (effect.type === "set_fact") {
              const inv = targetAgent.inventory;
              const value = evaluate(effect.value, {
                beliefs: targetAgent.getAllBeliefs(),
                locals: new Map(),
                agentState: {
                  player: { get: () => 0 },
                  npc: {
                    get: (p: string) =>
                      (p in inv ? inv[p as keyof typeof inv] : 0) as Value,
                  },
                  settlement: null,
                },
                currentTick: tick,
              });
              if (value === undefined) {
                console.warn(`[tick:phase8] Trigger "${rule.id}" set_fact value for key "${effect.key}" evaluated to undefined, skipping`);
                continue;
              }
              targetAgent.setBelief(effect.key, {
                key: effect.key,
                value,
                tick,
                source: "trigger:" + rule.id,
              });
            } else {
              console.warn(`[tick:phase8] Trigger "${rule.id}" has unhandled effect type "${effect.type}" — only set_fact is supported in trigger execution`);
            }
          }
        }
      }
    }

    state.triggerRegistry.clearChangedFacts();
  }
}
