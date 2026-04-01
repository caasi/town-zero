import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { TileSchema } from "./TileSchema.js";
import { AgentSchema } from "./AgentSchema.js";
import { SettlementSchema } from "./SettlementSchema.js";

export class WorldState extends Schema {
  @type("uint32") tick: number = 0;
  @type([TileSchema]) tiles = new ArraySchema<TileSchema>();
  @type({ map: AgentSchema }) agents = new MapSchema<AgentSchema>();
  @type({ map: SettlementSchema }) settlements = new MapSchema<SettlementSchema>();
}
