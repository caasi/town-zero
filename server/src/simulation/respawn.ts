import type { Position } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Settlement } from "./settlement.js";
import type { SimulationState } from "./tick.js";

// Stopgap until downed NPCs (CLAUDE.md TODO): a dead NPC comes back, so a
// room that lives long still has someone to talk to and something to fight.
export const NPC_RESPAWN_TICKS = 240;  // ~30s: a village NPC comes back for free
export const BEAST_BREED_TICKS = 240;  // ~30s: then the den pays food for a new beast
export const BEAST_BREED_FOOD = 5;

/** A territory tile with no living agent on it (the first tile if all are taken). */
export function findSpawnTile(settlement: Settlement, state: SimulationState): Position {
  const occupied = new Set(
    Array.from(state.agents.values())
      .filter((a) => a.isAlive())
      .map((a) => `${a.position.x},${a.position.y}`),
  );
  return settlement.territory.find((t) => !occupied.has(`${t.x},${t.y}`)) ?? settlement.territory[0];
}

/**
 * Brings dead NPCs back at their home. Players revive by their own request
 * (GameRoom). The dead agent object is reused, so it keeps its id, beliefs and
 * MapMemory; a den beast is a "new" beast only in the story.
 */
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
    // A den without food waits; it breeds as soon as beasts bring food home.
    // With no beast alive nobody brings food, so the first one is free: a den
    // never dies out.
    if (den && livingMembers(home, state) > 0 && !home.removeResource("food", BEAST_BREED_FOOD)) continue;
    agent.revive(findSpawnTile(home, state));
    if (!home.populationIds.includes(agent.id)) home.populationIds.push(agent.id);
    respawnAt.delete(agent.id);
  }
}

function livingMembers(settlement: Settlement, state: SimulationState): number {
  return settlement.populationIds.filter((id) => state.agents.get(id)?.isAlive()).length;
}

// processTick drops dead NPCs from populationIds, so the home is found by faction.
function homeByFaction(agent: Agent, state: SimulationState): Settlement | undefined {
  return Array.from(state.settlements.values()).find((s) => s.faction === agent.faction);
}
