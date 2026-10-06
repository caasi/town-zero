import type { ScenarioData, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";

export interface ScenarioLoadResult {
  dialogueTrees: Map<string, DialogueTreeData>;
}

export function loadScenario(
  data: ScenarioData,
  state: SimulationState,
): ScenarioLoadResult {
  const dialogueTrees = new Map<string, DialogueTreeData>();

  // Spawn NPCs
  for (const npcDef of data.npcs) {
    const agent = new Agent({
      id: npcDef.id,
      name: npcDef.name,
      position: npcDef.position,
      faction: npcDef.faction,
      role: npcDef.role,
      controller: "bot",
    });

    // Inject initial beliefs
    for (const { key, value } of npcDef.initialBeliefs) {
      agent.setBelief(key, { key, value, tick: state.tick, source: npcDef.id });
    }

    state.agents.set(npcDef.id, agent);

    if (npcDef.handlers) {
      for (const { event, handler } of npcDef.handlers) {
        const list = agent.eventHandlers.get(event) ?? [];
        list.push(handler);
        agent.eventHandlers.set(event, list);
      }
    }
  }

  // Register dialogue trees
  for (const tree of data.dialogues) {
    dialogueTrees.set(tree.id, tree);
  }

  return { dialogueTrees };
}
