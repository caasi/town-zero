import type { ResourceType, Position } from "./types.js";
import type { NpcEventName, EventHandler } from "./script-dsl/event-types.js";

// --- Values ---

export type Value = boolean | number | string;

// --- Expressions ---

export type Expr =
  | { type: "literal"; value: Value }
  | { type: "fact_ref"; key: string }
  | { type: "local_ref"; key: string }
  | { type: "prop_ref"; target: "player" | "npc" | "settlement"; prop: string }
  | { type: "compare"; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte"; left: Expr; right: Expr }
  | { type: "logic"; op: "and" | "or" | "not"; args: Expr[] }
  | { type: "call"; fn: string; args: Expr[] }
  | { type: "arithmetic"; op: "add" | "sub" | "mul" | "div"; left: Expr; right: Expr };

// --- Text Templates ---

export type TextTemplate = Array<string | Expr>;

// --- Agent References ---

export type AgentRef = string; // agent ID, "$player", "$npc", "$faction:xxx"

// --- Effects ---

// Effects emitted by dialogue actions and script-level triggers. The dialogue
// executor has a handler for every variant here. `bubble` is deliberately NOT
// part of this union — it's emitted only from NPC event handlers and executed
// by the event-dispatch applier. See `EventEffect` in `script-dsl/event-types`.
export type Effect =
  | { type: "set_fact"; target: AgentRef; key: string; value: Expr }
  | { type: "set_local"; key: string; value: Expr }
  | { type: "give_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "take_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "damage"; target: AgentRef; amount: Expr }
  | { type: "register_trigger"; trigger: TriggerRule };

// --- Facts & Beliefs ---

export interface Fact {
  key: string;
  value: Value;
  tick: number;
  source: string; // agent ID who originated this fact
}

// --- Dialogue Progress ---

export interface DialogueProgressEntry {
  visitedNodes: string[];
  selectedOptions: Record<string, string>;
  locals: Record<string, Value>;
}

// --- Triggers ---

export interface TriggerRule {
  id: string;
  when: Expr;
  then: Effect[];
  targets: AgentRef[];
  once: boolean;
  source: "scenario" | "runtime";
  fired: boolean;
}

// --- Dialogue Nodes (Compiled) ---

export type DialogueNodeData =
  | { type: "text"; speaker: string; content: TextTemplate; next: string }
  | { type: "choice"; options: ChoiceOptionData[] }
  | { type: "request"; label: TextTemplate; gateType: "llm"; nextYes: string; nextNo: string }
  | { type: "action"; effects: Effect[]; next: string }
  | { type: "end" };

export interface ChoiceOptionData {
  id: string;
  label: TextTemplate;
  condition?: Expr;
  next: string;
}

export interface DialogueTreeData {
  id: string;
  root: string;
  nodes: Record<string, DialogueNodeData>;
  triggers: TriggerRule[];
  entryPoints?: Array<{ nodeId: string; condition: Expr }>;
}

// --- Scenario ---

export interface NpcHandlerEntry {
  event: NpcEventName;
  handler: EventHandler<unknown>;
}

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  faction: string;
  position: Position;
  initialBeliefs: Array<{ key: string; value: Value }>;
  dialogueIds: string[];
  handlers?: NpcHandlerEntry[];
}

export interface ScenarioData {
  id: string;
  npcs: NpcDefinition[];
  dialogues: DialogueTreeData[];
  triggers: TriggerRule[];
}
