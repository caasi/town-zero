import { schema, type SchemaType } from "@colyseus/schema";
import { StructureSchema } from "./StructureSchema.js";

export const SettlementSchema = schema({
  id: "string",
  faction: "string",
  type: "string",
  x: "number",
  y: "number",
  population: "number",
  maxPopulation: "number",
  inventory: { map: "number" },
  structures: { array: StructureSchema },
}, "SettlementSchema");

export type SettlementSchema = SchemaType<typeof SettlementSchema>;
