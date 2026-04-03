import type { ScenarioData, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import { TriggerRegistry } from "../dialogue/trigger-registry.js";
import type { SimulationState } from "./tick.js";

export interface ScenarioLoadResult {
  triggerRegistry: TriggerRegistry;
  dialogueTrees: Map<string, DialogueTreeData>;
}

export function loadScenario(
  data: ScenarioData,
  state: SimulationState,
): ScenarioLoadResult {
  const triggerRegistry = new TriggerRegistry();
  const dialogueTrees = new Map<string, DialogueTreeData>();

  // Spawn NPCs
  for (const npcDef of data.npcs) {
    const agent = new Agent({
      id: npcDef.id,
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
  }

  // Register dialogue trees
  for (const tree of data.dialogues) {
    dialogueTrees.set(tree.id, tree);

    // Register dialogue-scoped triggers
    for (const trigger of tree.triggers) {
      triggerRegistry.register(trigger);
    }
  }

  // Register scenario-level triggers
  for (const trigger of data.triggers) {
    triggerRegistry.register(trigger);
  }

  return { triggerRegistry, dialogueTrees };
}
