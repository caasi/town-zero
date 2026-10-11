import type { Position } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Settlement } from "./settlement.js";
import type { SimulationState } from "./tick.js";

export const NPC_RESPAWN_TICKS = 240;
export const BEAST_BREED_TICKS = 240;
export const BEAST_BREED_FOOD = 5;

export function findSpawnTile(settlement: Settlement, state: SimulationState): Position {
  const occupied = new Set(
    Array.from(state.agents.values())
      .filter((a) => a.isAlive())
      .map((a) => `${a.position.x},${a.position.y}`),
  );
  return settlement.territory.find((t) => !occupied.has(`${t.x},${t.y}`)) ?? settlement.territory[0];
}

export function processRespawns(state: SimulationState, respawnAt: Map<string, number>): void {
  for (const agent of state.agents.values()) {
    if (agent.isAlive() || agent.controller === "player") continue;
    const home = homeByFaction(agent, state);
    if (!home) continue;
    const den = home.type === "den";
    const due = respawnAt.get(agent.id);
    if (due === undefined) {
      respawnAt.set(agent.id, state.tick + (den ? BEAST_BREED_TICKS : NPC_RESPAWN_TICKS));
      continue;
    }
    if (state.tick < due) continue;
    if (den && livingMembers(home, state) > 0 && !home.removeResource("food", BEAST_BREED_FOOD)) continue;
    agent.revive(findSpawnTile(home, state));
    if (!home.populationIds.includes(agent.id)) home.populationIds.push(agent.id);
    respawnAt.delete(agent.id);
  }
}

function livingMembers(settlement: Settlement, state: SimulationState): number {
  return settlement.populationIds.filter((id) => state.agents.get(id)?.isAlive()).length;
}

function homeByFaction(agent: Agent, state: SimulationState): Settlement | undefined {
  return Array.from(state.settlements.values()).find((s) => s.faction === agent.faction);
}
