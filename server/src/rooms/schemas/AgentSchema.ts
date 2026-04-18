import { schema, type SchemaType } from "@colyseus/schema";

export const AgentSchema = schema({
  id: "string",
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
}, "AgentSchema");

export type AgentSchema = SchemaType<typeof AgentSchema>;
