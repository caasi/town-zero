import { DEFAULT_VISION_RADIUS, SCOUT_VISION_RADIUS } from "@town-zero/shared";
import type { EntitySnapshot } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";

export function getVisionRadius(agent: Agent): number {
  return agent.role === "scout" ? SCOUT_VISION_RADIUS : DEFAULT_VISION_RADIUS;
}

export function updateVision(
  agent: Agent,
  grid: Grid,
  allAgents: Map<string, Agent>,
  tick: number,
): void {
  if (!agent.isAlive()) return;

  const radius = getVisionRadius(agent);
  const visibleTiles = grid.getTilesInRadius(agent.position, radius);

  const agentsByPos = new Map<string, Agent[]>();
  for (const [, other] of allAgents) {
    if (other.id === agent.id || !other.isAlive()) continue;
    const key = `${other.position.x},${other.position.y}`;
    const arr = agentsByPos.get(key) ?? [];
    arr.push(other);
    agentsByPos.set(key, arr);
  }

  for (const tile of visibleTiles) {
    const terrain = grid.getTerrain(tile.x, tile.y)!;
    const key = `${tile.x},${tile.y}`;
    const agentsHere = agentsByPos.get(key) ?? [];
    const snapshots: EntitySnapshot[] = agentsHere.map((a) => ({
      id: a.id,
      type: a.faction.startsWith("den") ? "monster" : "agent",
      faction: a.faction,
      position: { ...a.position },
      role: a.role,
      hp: a.hp,
      maxHp: a.maxHp,
    }));

    agent.recordTile(tile.x, tile.y, terrain, snapshots, tick, grid.getResourceAmount(tile.x, tile.y));
  }
}

export const storeFoodKey = (settlementId: string) => `food:${settlementId}`;

/**
 * An agent inside a settlement sees its store. Away from it, the agent knows
 * only the count of its last visit, or what a same-faction neighbour told it
 * (beliefs merge in mergeAdjacentMemories).
 */
export function updateStoreKnowledge(agent: Agent, settlements: Map<string, Settlement>, tick: number): void {
  if (!agent.isAlive()) return;
  for (const s of settlements.values()) {
    if (!s.isInTerritory(agent.position)) continue;
    const key = storeFoodKey(s.id);
    agent.setBelief(key, { key, value: s.inventory.food, tick, source: agent.id });
  }
}

export function mergeAdjacentMemories(agents: Agent[], grid: Grid): void {
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];

      if (!a.isAlive() || !b.isAlive()) continue;
      if (a.faction !== b.faction) continue;
      if (!grid.isAdjacent(a.position, b.position)) continue;

      a.mergeMemory(b.getAllMemory());
      b.mergeMemory(a.getAllMemory());

      a.mergeBeliefs(b.getAllBeliefs());
      b.mergeBeliefs(a.getAllBeliefs());
    }
  }
}
