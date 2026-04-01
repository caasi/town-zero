import { Schema, type, ArraySchema } from "@colyseus/schema";
import { StructureSchema } from "./StructureSchema.js";

export class SettlementSchema extends Schema {
  @type("string") id: string = "";
  @type("string") faction: string = "";
  @type("string") settlementType: string = "village";
  @type("int32") food: number = 0;
  @type("int32") material: number = 0;
  @type("int32") currency: number = 0;
  @type([StructureSchema]) structures = new ArraySchema<StructureSchema>();
}
