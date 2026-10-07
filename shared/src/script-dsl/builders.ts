import type {
  Value, Expr, Effect, AgentRef, TextTemplate,
  ScenarioData, NpcDefinition, DialogueTreeData, DialogueNodeData,
  ChoiceOptionData, Gender, FarewellLine, ReplyLineData, ReplyLines,
} from "../script-types.js";
import type { NpcHandlerEntry } from "../script-types.js";
import type { ResourceType } from "../types.js";
import { ExprBuilder, toExpr, type ExprOrValue } from "./expressions.js";
import type { NpcEventMap, NpcEventName, EventHandler, EventEffect } from "./event-types.js";

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

export function bubble(target: AgentRef, text: string, opts: { durationTicks: number }): EventEffect {
  return { type: "bubble", target, text, durationTicks: opts.durationTicks };
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

// --- Reply line builder ---

export interface LineBuilder {
  when(condition: ExprBuilder): LineBuilder;
  goto(nodeId: string): LineBuilder;
}

type LineData = ReplyLineData & { condition?: Expr };

function createLineBuilder(id: string, description: string, text: TextTemplate): { builder: LineBuilder; getData: () => LineData } {
  const data: LineData = { id, description, text, next: "" };
  const builder: LineBuilder = {
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
  /** NPC reply lines; Jev picks one from the NPC's profile (spec 004). The first line is the neutral fallback. */
  reply(id: string, lines: [LineBuilder, ...LineBuilder[]]): void;
  line(id: string, description: string, text: string | TextTemplate): LineBuilder;
  action(id: string, effects: Effect[], opts: { next: string }): void;
  end(id: string): void;
  option(label: string | TextTemplate): OptionBuilder;
  entry(nodeId: string, condition: ExprBuilder): void;
}

function createDialogueBuilder(
  dialogueId: string,
): { api: DialogueBuilderApi; build: () => DialogueTreeData } {
  const nodes: Record<string, DialogueNodeData> = {};
  const entryPoints: Array<{ nodeId: string; condition: Expr }> = [];
  const nodeOrder: string[] = [];
  const optionBuilders = new Map<OptionBuilder, () => ChoiceOptionData>();
  const lineBuilders = new Map<LineBuilder, () => LineData>();

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

    reply(id, lineList) {
      const lines = lineList.map((lb, i) => {
        const getData = lineBuilders.get(lb);
        if (!getData) throw new Error(`Unknown line builder at index ${i} in reply node "${id}"`);
        const data = getData();
        if (data.next === "") throw new Error(`Line "${data.id}" in reply node "${id}" is missing goto() target`);
        return data;
      });
      if (lines[0].condition) {
        throw new Error(`The first line of reply node "${id}" is the fallback and cannot have a condition`);
      }
      const ids = new Set(lines.map((l) => l.id));
      if (ids.size !== lines.length) throw new Error(`Reply node "${id}" has duplicate line ids`);
      const [{ condition: _none, ...first }, ...rest] = lines;
      registerNode(id, { type: "reply", lines: [first, ...rest] as ReplyLines });
    },

    line(id, description, text) {
      const { builder, getData } = createLineBuilder(id, description, typeof text === "string" ? [text] : text);
      lineBuilders.set(builder, getData);
      return builder;
    },

    action(id, effects, opts) {
      registerNode(id, { type: "action", effects, next: opts.next });
    },


    end(id) {
      registerNode(id, { type: "end" });
    },

    option(label) {
      const tpl: TextTemplate = typeof label === "string" ? [label] : label;
      const { builder, getData } = createOptionBuilder(tpl);
      optionBuilders.set(builder, getData);
      return builder;
    },

    entry(nodeId, condition) {
      entryPoints.push({ nodeId, condition: condition.toExpr() });
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
    const tree: DialogueTreeData = { id: dialogueId, root, nodes };
    if (entryPoints.length > 0) {
      tree.entryPoints = entryPoints;
    }
    return tree;
  }

  return { api, build };
}

// SOURCE OF TRUTH for event keys + payloads: NpcEventMap (event-types.ts).
// `on` is derived from NpcEventMap by turning the per-key signature union
// into an intersection — TypeScript treats an intersection of function types
// as an overload set, so each event key narrows its payload exactly.
// Adding a key to NpcEventMap adds a new overload automatically.
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;

type NpcOnOverloads = UnionToIntersection<{
  [K in NpcEventName]: (event: K, handler: EventHandler<NpcEventMap[K]>) => NpcBuilder;
}[NpcEventName]>;

export interface NpcBuilder {
  on: NpcOnOverloads;
}

// --- Scenario builder ---

interface ScenarioBuilderApi {
  npc(id: string, opts: {
    name?: string;
    role: string;
    faction: string;
    position: { x: number; y: number };
    initialBeliefs: Array<{ key: string; value: Value }>;
    gender: Gender;
    personality: string;
    farewells?: Array<string | { text: string; when: ExprBuilder }>;
  }): NpcBuilder;
  dialogue(npcId: string, dialogueId: string, fn: (d: DialogueBuilderApi) => void): void;
}

export function scenario(id: string, fn: (s: ScenarioBuilderApi) => void): ScenarioData {
  const npcs: NpcDefinition[] = [];
  const dialogues: DialogueTreeData[] = [];
  const npcDialogueMap = new Map<string, string[]>();
  const dialogueIds = new Set<string>();

  const api: ScenarioBuilderApi = {
    npc(npcId, opts) {
      if (npcDialogueMap.has(npcId)) {
        throw new Error(`Duplicate npcId "${npcId}" in scenario "${id}"`);
      }
      npcDialogueMap.set(npcId, []);
      const handlers: NpcHandlerEntry[] = [];
      npcs.push({
        id: npcId,
        name: opts.name ?? npcId,
        role: opts.role,
        faction: opts.faction,
        position: opts.position,
        initialBeliefs: opts.initialBeliefs,
        profile: {
          gender: opts.gender,
          personality: opts.personality,
          farewells: (opts.farewells ?? []).map((f): FarewellLine =>
            typeof f === "string" ? { text: [f] } : { text: [f.text], condition: f.when.toExpr() }),
        },
        dialogueIds: npcDialogueMap.get(npcId)!,
        handlers,
      });
      const builder: NpcBuilder = {
        on(event: NpcEventName, handler: EventHandler<any>): NpcBuilder {
          handlers.push({ event, handler: handler as EventHandler<unknown> });
          return builder;
        },
      };
      return builder;
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
      const { api: dApi, build } = createDialogueBuilder(dialogueId);
      builderFn(dApi);
      dialogues.push(build());
      ids.push(dialogueId);
    },
  };

  fn(api);
  return { id, npcs, dialogues };
}
