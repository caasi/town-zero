import type { ResourceType, Position } from "./types.js";
import type { NpcEventName, EventHandler } from "./script-dsl/event-types.js";

export type Value = boolean | number | string;

export type Expr =
  | { type: "literal"; value: Value }
  | { type: "fact_ref"; key: string }
  | { type: "local_ref"; key: string }
  | { type: "prop_ref"; target: "player" | "npc" | "settlement"; prop: string }
  | { type: "compare"; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte"; left: Expr; right: Expr }
  | { type: "logic"; op: "and" | "or" | "not"; args: Expr[] }
  | { type: "call"; fn: string; args: Expr[] }
  | { type: "arithmetic"; op: "add" | "sub" | "mul" | "div"; left: Expr; right: Expr };

export type TextTemplate = Array<string | Expr>;

export type AgentRef = string;

export type Effect =
  | { type: "set_fact"; target: AgentRef; key: string; value: Expr }
  | { type: "set_local"; key: string; value: Expr }
  | { type: "give_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "take_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "damage"; target: AgentRef; amount: Expr };

export interface Fact {
  key: string;
  value: Value;
  tick: number;
  source: string;
}

export interface DialogueProgressEntry {
  visitedNodes: string[];
  selectedOptions: Record<string, string>;
  locals: Record<string, Value>;
}

export type DialogueNodeData =
  | { type: "text"; speaker: string; content: TextTemplate; next: string }
  | { type: "choice"; options: ChoiceOptionData[] }
  | { type: "reply"; lines: ReplyLines }
  | { type: "action"; effects: Effect[]; next: string }
  | { type: "end" };

export interface ChoiceOptionData {
  id: string;
  label: TextTemplate;
  condition?: Expr;
  next: string;
}

export interface ReplyLineData {
  id: string;
  description: string;
  text: TextTemplate;
  next: string;
}

export type ReplyLines = [ReplyLineData, ...Array<ReplyLineData & { condition?: Expr }>];

export interface DialogueTreeData {
  id: string;
  root: string;
  nodes: Record<string, DialogueNodeData>;
  entryPoints?: Array<{ nodeId: string; condition: Expr }>;
}

export interface NpcHandlerEntry {
  event: NpcEventName;
  handler: EventHandler<unknown>;
}

export type Gender =
  | { kind: "male" }
  | { kind: "female" }
  | { kind: "nonbinary" }
  | { kind: "other"; description: string };

export interface FarewellLine {
  text: TextTemplate;
  condition?: Expr;
}

export interface NpcProfile {
  gender: Gender;
  personality: string;
  farewells: FarewellLine[];
}

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  faction: string;
  position: Position;
  initialBeliefs: Array<{ key: string; value: Value }>;
  profile: NpcProfile;
  dialogueIds: string[];
  handlers?: NpcHandlerEntry[];
}

export interface ScenarioData {
  id: string;
  npcs: NpcDefinition[];
  dialogues: DialogueTreeData[];
}
