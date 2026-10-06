import type { InputFrame, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { executeFrame, type TalkResult } from "./execute-frame.js";
import { processConsumption } from "./resources.js";
import { updateVision, mergeAdjacentMemories, getVisionRadius } from "./vision.js";
import { decideBotAction } from "../ai/bot-controller.js";
import { dispatch, applyEventEffects } from "./event-dispatch.js";

export interface SimulationState {
  grid: Grid;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  tick: number;
  activeSessions: Map<string, import("../dialogue/dialogue-session.js").DialogueSession>;
  dialogueTrees: Map<string, DialogueTreeData>;
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

    const settlement = Array.from(settlements.values()).find((s) =>
      s.populationIds.includes(agent.id),
    );
    if (settlement) {
      const frames = decideBotAction(agent, settlement);
      agent.planBacklog = frames;
    }
  }

  // Phase 3: Consumption
  for (const [, agent] of agents) {
    processConsumption(agent, tick);
  }

  // Phase 4: Vision update
  for (const [, agent] of agents) {
    updateVision(agent, grid, agents, tick);
  }

  // Phase 4b: Bubble expiry + event dispatch.
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
    // Skip the O(N_players) scan + proximityState bookkeeping for NPCs that
    // registered only non-proximity handlers (talk:*, combat:*). Checking all
    // three keys keeps this cheap and avoids mutating proximityState for
    // handlers that wouldn't observe it anyway.
    if (
      !npc.eventHandlers.has("proximity:enter") &&
      !npc.eventHandlers.has("proximity:stay") &&
      !npc.eventHandlers.has("proximity:leave")
    ) continue;

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

  // Dead members must not hold population slots, or joins are refused at the cap.
  // A dead player keeps its slot so it can revive; GameRoom.onLeave frees it.
  for (const settlement of settlements.values()) {
    settlement.populationIds = settlement.populationIds.filter((id) => {
      const member = agents.get(id);
      return member?.isAlive() || member?.controller === "player";
    });
  }

  // Phase 5: Memory merge for adjacent same-faction agents
  const agentList = Array.from(agents.values()).filter((a) => a.isAlive());
  mergeAdjacentMemories(agentList, grid);

  return talkResults;
}
