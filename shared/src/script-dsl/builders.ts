import type {
  Value, Expr, Effect, AgentRef, TextTemplate,
  ScenarioData, NpcDefinition, DialogueTreeData, DialogueNodeData,
  ChoiceOptionData, TriggerRule,
} from "../script-types.js";
import type { ResourceType } from "../types.js";
import { ExprBuilder, toExpr, type ExprOrValue } from "./expressions.js";

// --- Simple effect builders ---

export function belief(key: string, value: Value): { key: string; value: Value } {
  return { key, value };
}

export function setFact(target: AgentRef, key: string, value: ExprOrValue): Effect {
  return { type: "set_fact", target, key, value: toExpr(value) };
}

export function give(target: AgentRef, item: ResourceType, amount: ExprOrValue): Effect {
  return { type: "give_item", target, item, amount: toExpr(amount) };
}

export function take(target: AgentRef, item: ResourceType, amount: ExprOrValue): Effect {
  return { type: "take_item", target, item, amount: toExpr(amount) };
}

export function damage(target: AgentRef, amount: ExprOrValue): Effect {
  return { type: "damage", target, amount: toExpr(amount) };
}

export function when(builder: ExprBuilder): Expr {
  return builder.toExpr();
}

// --- Option builder ---

export interface OptionBuilder {
  when(condition: ExprBuilder): OptionBuilder;
  goto(nodeId: string): OptionBuilder;
}

function createOptionBuilder(label: TextTemplate): { builder: OptionBuilder; getData: () => ChoiceOptionData } {
  const data: ChoiceOptionData = {
    id: "",
    label,
    next: "",
  };

  const builder: OptionBuilder = {
    when(condition: ExprBuilder) {
      data.condition = condition.toExpr();
      return builder;
    },
    goto(nodeId: string) {
      data.next = nodeId;
      return builder;
    },
  };

  return { builder, getData: () => data };
}

// --- Dialogue builder ---

interface DialogueBuilderApi {
  text(id: string, content: TextTemplate, opts?: { context?: string; next?: string; speaker?: string }): void;
  choice(id: string, options: OptionBuilder[]): void;
  action(id: string, effects: Effect[], opts: { next: string }): void;
  request(id: string, label: TextTemplate, opts: { nextYes: string; nextNo: string }): void;
  end(id: string): void;
  trigger(whenExpr: Expr, thenEffects: Effect[], opts: { targets: AgentRef[]; once?: boolean }): void;
  option(label: string | TextTemplate): OptionBuilder;
}

function createDialogueBuilder(
  dialogueId: string,
  scenarioId: string,
): { api: DialogueBuilderApi; build: () => DialogueTreeData } {
  const nodes: Record<string, DialogueNodeData> = {};
  const triggers: TriggerRule[] = [];
  const nodeOrder: string[] = [];
  const optionBuilders = new Map<OptionBuilder, () => ChoiceOptionData>();
  let triggerIndex = 0;

  const pendingAutoChain: string[] = [];

  function registerNode(id: string, node: DialogueNodeData): void {
    if (pendingAutoChain.length > 0) {
      const prevId = pendingAutoChain.pop()!;
      const prev = nodes[prevId];
      if (prev && prev.type === "text") {
        (prev as { next: string }).next = id;
      }
    }
    nodes[id] = node;
    nodeOrder.push(id);
  }

  const api: DialogueBuilderApi = {
    text(id, content, opts) {
      const speaker = opts?.speaker ?? "npc";
      registerNode(id, { type: "text", speaker, content, next: opts?.next ?? "" });
      if (!opts?.next) {
        pendingAutoChain.push(id);
      }
    },

    choice(id, options) {
      const optionData = options.map((ob, i) => {
        const getData = optionBuilders.get(ob);
        if (!getData) throw new Error(`Unknown option builder at index ${i}`);
        const data = getData();
        data.id = `${id}_opt_${i}`;
        if (data.next === "") {
          throw new Error(`Option "${data.id}" in choice node "${id}" is missing goto() target`);
        }
        return data;
      });
      registerNode(id, { type: "choice", options: optionData });
    },

    action(id, effects, opts) {
      registerNode(id, { type: "action", effects, next: opts.next });
    },

    request(id, label, opts) {
      registerNode(id, { type: "request", label, gateType: "llm", nextYes: opts.nextYes, nextNo: opts.nextNo });
    },

    end(id) {
      registerNode(id, { type: "end" });
    },

    trigger(whenExpr, thenEffects, opts) {
      triggers.push({
        id: `scenario:${scenarioId}:dialogue:${dialogueId}:${triggerIndex++}`,
        when: whenExpr,
        then: thenEffects,
        targets: opts.targets,
        once: opts.once ?? true,
        source: "scenario",
        fired: false,
      });
    },

    option(label) {
      const tpl: TextTemplate = typeof label === "string" ? [label] : label;
      const { builder, getData } = createOptionBuilder(tpl);
      optionBuilders.set(builder, getData);
      return builder;
    },
  };

  function build(): DialogueTreeData {
    if (nodeOrder.length === 0) {
      throw new Error(`Dialogue "${dialogueId}" must contain at least one node`);
    }
    for (const nodeId of nodeOrder) {
      const node = nodes[nodeId];
      if (node.type === "text" && node.next === "") {
        throw new Error(`Text node "${nodeId}" in dialogue "${dialogueId}" is missing a next node`);
      }
    }
    const root = nodeOrder[0];
    return { id: dialogueId, root, nodes, triggers };
  }

  return { api, build };
}

// --- Scenario builder ---

interface ScenarioBuilderApi {
  npc(id: string, opts: {
    role: string;
    faction: string;
    position: { x: number; y: number };
    initialBeliefs: Array<{ key: string; value: Value }>;
  }): void;
  dialogue(npcId: string, dialogueId: string, fn: (d: DialogueBuilderApi) => void): void;
  trigger(whenExpr: Expr, thenEffects: Effect[], opts: { targets: AgentRef[]; once?: boolean }): void;
}

export function scenario(id: string, fn: (s: ScenarioBuilderApi) => void): ScenarioData {
  const npcs: NpcDefinition[] = [];
  const dialogues: DialogueTreeData[] = [];
  const triggers: TriggerRule[] = [];
  const npcDialogueMap = new Map<string, string[]>();
  const dialogueIds = new Set<string>();
  let triggerIndex = 0;

  const api: ScenarioBuilderApi = {
    npc(npcId, opts) {
      if (npcDialogueMap.has(npcId)) {
        throw new Error(`Duplicate npcId "${npcId}" in scenario "${id}"`);
      }
      npcDialogueMap.set(npcId, []);
      npcs.push({
        id: npcId,
        role: opts.role,
        faction: opts.faction,
        position: opts.position,
        initialBeliefs: opts.initialBeliefs,
        dialogueIds: npcDialogueMap.get(npcId)!,
      });
    },

    dialogue(npcId, dialogueId, builderFn) {
      const ids = npcDialogueMap.get(npcId);
      if (!ids) {
        throw new Error(`Cannot add dialogue "${dialogueId}" to unregistered NPC "${npcId}" in scenario "${id}". Register the NPC with s.npc() first.`);
      }
      if (dialogueIds.has(dialogueId)) {
        throw new Error(`Duplicate dialogueId "${dialogueId}" in scenario "${id}"`);
      }
      dialogueIds.add(dialogueId);
      const { api: dApi, build } = createDialogueBuilder(dialogueId, id);
      builderFn(dApi);
      dialogues.push(build());
      ids.push(dialogueId);
    },

    trigger(whenExpr, thenEffects, opts) {
      triggers.push({
        id: `scenario:${id}:${triggerIndex++}`,
        when: whenExpr,
        then: thenEffects,
        targets: opts.targets,
        once: opts.once ?? true,
        source: "scenario",
        fired: false,
      });
    },
  };

  fn(api);
  return { id, npcs, dialogues, triggers };
}
