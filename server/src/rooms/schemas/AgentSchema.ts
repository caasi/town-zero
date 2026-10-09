import { schema, type SchemaType } from "@colyseus/schema";

export const AgentSchema = schema({
  id: "string",
  name: "string",
  faction: "string",
  role: "string",
  x: "number",
  y: "number",
  hp: "number",
  maxHp: "number",
  state: "string",
  controller: "string",
  facing: "string",
  lastProcessedInput: "number",
  inventory: { map: "number" },
  bubbleText: "string",
  talkable: "boolean", // has a dialogue tree with an entry point; set once, a tree never changes
  busy: "boolean", // an NPC in a dialogue with a player; a talk to it is refused
}, "AgentSchema");

export type AgentSchema = SchemaType<typeof AgentSchema>;
