import { schema, type SchemaType } from "@colyseus/schema";

export const StructureSchema = schema({
  id: "string",
  type: "string",
  x: "number",
  y: "number",
  operatorId: "string",
}, "StructureSchema");

export type StructureSchema = SchemaType<typeof StructureSchema>;
