import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";
import { checkCondition, type EvalContext } from "../dialogue/evaluator.js";

export function findTreeIdForNpc(npcId: string, state: SimulationState): string | null {
  if (state.dialogueTrees.has(npcId)) return npcId;
  for (const [id] of state.dialogueTrees) {
    if (id.startsWith(`${npcId}-`) || id.startsWith(`${npcId}:`)) return id;
  }
  return null;
}

function buildEvalContext(player: Agent, npc: Agent, state: SimulationState): EvalContext {
  return {
    beliefs: npc.getAllBeliefs(),
    locals: new Map(),
    agentState: {
      player: { get: (p: string) => {
        if (p === "hp") return player.hp;
        if (p === "id") return player.id;
        if (p === "role") return player.role;
        if (p === "faction") return player.faction;
        if (p === "x") return player.position.x;
        if (p === "y") return player.position.y;
        const inv = player.inventory;
        if (p in inv) return inv[p as keyof typeof inv];
        return 0;
      }},
      npc: { get: (p: string) => {
        if (p === "hp") return npc.hp;
        if (p === "id") return npc.id;
        if (p === "role") return npc.role;
        if (p === "faction") return npc.faction;
        if (p === "x") return npc.position.x;
        if (p === "y") return npc.position.y;
        const inv = npc.inventory;
        if (p in inv) return inv[p as keyof typeof inv];
        return 0;
      }},
      settlement: null,
    },
    currentTick: state.tick,
  };
}

/** Side-effect-free: evaluates entryPoints only. Returns the matching nodeId, or null. */
export function resolveDialogueEntryNode(player: Agent, npc: Agent, state: SimulationState): string | null {
  const treeId = findTreeIdForNpc(npc.id, state);
  if (!treeId) return null;
  const tree = state.dialogueTrees.get(treeId)!;
  if (!tree.entryPoints || tree.entryPoints.length === 0) return null;

  const ctx = buildEvalContext(player, npc, state);
  for (const ep of tree.entryPoints) {
    if (checkCondition(ep.condition, ctx)) return ep.nodeId;
  }
  return null;
}

export function hasMatchingDialogueEntry(player: Agent, npc: Agent, state: SimulationState): boolean {
  return resolveDialogueEntryNode(player, npc, state) !== null;
}
