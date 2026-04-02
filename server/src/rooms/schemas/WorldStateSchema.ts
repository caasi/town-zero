import { schema, type SchemaType } from "@colyseus/schema";
import { AgentSchema } from "./AgentSchema.js";
import { SettlementSchema } from "./SettlementSchema.js";
import { TileSchema } from "./TileSchema.js";

export const WorldStateSchema = schema({
  tick: "number",
  width: "number",
  height: "number",
  agents: { map: AgentSchema },
  settlements: { map: SettlementSchema },
  tiles: { map: TileSchema },
}, "WorldStateSchema");

export type WorldStateSchema = SchemaType<typeof WorldStateSchema>;
