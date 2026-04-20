import { MERCHANT_SPAWN_INTERVAL } from "@town-zero/shared";
import type { Fact, Value, InputFrame, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { executeFrame, type TalkResult } from "./execute-frame.js";
import { processProduction, processConsumption } from "./resources.js";
import { updateVision, mergeAdjacentMemories, getVisionRadius } from "./vision.js";
import { decideBotAction } from "../ai/bot-controller.js";
import { TriggerRegistry } from "../dialogue/trigger-registry.js";
import { evaluate } from "../dialogue/evaluator.js";
import { dispatch, applyEventEffects } from "./event-dispatch.js";

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


export function processTick(state: SimulationState): TalkResult[] {
  state.tick++;

  const { grid, agents, settlements, tick } = state;
  const talkResults: TalkResult[] = [];

  // Phase 1: Consume one InputFrame per alive agent
  for (const [, agent] of agents) {
    if (!agent.isAlive()) continue;

    let frame: InputFrame | undefined;

    if (agent.inputQueue.length > 0) {
      frame = agent.inputQueue.shift()!;
    } else if (agent.planBacklog.length > 0) {
      frame = agent.planBacklog.shift()!;
    }

    if (frame) {
      const ctx = { grid, agent, agents, settlements, activeSessions: state.activeSessions, simState: state, talkResults };
      executeFrame(frame, ctx);
    }
  }

  // Phase 2: Bot controller for idle bot agents
  for (const [, agent] of agents) {
    if (!agent.isAlive() || agent.controller !== "bot") continue;
    if (agent.inputQueue.length > 0 || agent.planBacklog.length > 0) continue;
    if (agent.role === "merchant") continue;

    const settlement = Array.from(settlements.values()).find((s) =>
      s.populationIds.includes(agent.id),
    );
    if (settlement) {
      const frames = decideBotAction(agent, settlement);
      agent.planBacklog = frames;
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

  // Phase 6b: Bubble expiry + event dispatch.
  for (const [, agent] of agents) {
    if (agent.bubbleText !== null && tick >= agent.bubbleExpiresAt) {
      agent.setBubble("", 0, tick);
    }
  }

  const alivePlayers: Array<{ agent: Agent; radius: number }> = [];
  for (const [, other] of agents) {
    if (other.controller !== "player" || !other.isAlive()) continue;
    alivePlayers.push({ agent: other, radius: getVisionRadius(other) });
  }

  for (const [, npc] of agents) {
    if (!npc.isAlive()) continue;
    if (npc.controller === "player") continue;
    if (npc.eventHandlers.size === 0) continue;

    const selfRef = {
      id: npc.id, faction: npc.faction, role: npc.role, position: { ...npc.position },
    };

    const currentInRange = new Map<string, number>();
    for (const { agent: p, radius } of alivePlayers) {
      const dx = Math.abs(p.position.x - npc.position.x);
      const dy = Math.abs(p.position.y - npc.position.y);
      const dist = dx + dy;
      if (dist <= radius) currentInRange.set(p.id, dist);
    }

    for (const [pid, dist] of currentInRange) {
      const playerAgent = agents.get(pid)!;
      const playerRef = {
        id: playerAgent.id, faction: playerAgent.faction, role: playerAgent.role,
        position: { ...playerAgent.position },
      };
      const prevTicks = npc.proximityState.get(pid);
      if (prevTicks === undefined) {
        const effs = dispatch(npc, "proximity:enter", {
          tick, self: selfRef, player: playerRef, distance: dist,
        });
        applyEventEffects(effs, state);
        npc.proximityState.set(pid, 1);
      } else {
        const effs = dispatch(npc, "proximity:stay", {
          tick, self: selfRef, player: playerRef, distance: dist, ticksInRange: prevTicks,
        });
        applyEventEffects(effs, state);
        npc.proximityState.set(pid, prevTicks + 1);
      }
    }

    for (const pid of [...npc.proximityState.keys()]) {
      if (currentInRange.has(pid)) continue;
      const playerAgent = agents.get(pid);
      const playerRef = playerAgent
        ? { id: playerAgent.id, faction: playerAgent.faction, role: playerAgent.role, position: { ...playerAgent.position } }
        : { id: pid, faction: "player", role: "player", position: { x: -1, y: -1 } };
      const effs = dispatch(npc, "proximity:leave", { tick, self: selfRef, player: playerRef });
      applyEventEffects(effs, state);
      npc.proximityState.delete(pid);
    }
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

  return talkResults;
}
