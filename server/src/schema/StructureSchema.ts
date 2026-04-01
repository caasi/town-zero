import { Schema, type } from "@colyseus/schema";

export class StructureSchema extends Schema {
  @type("string") id: string = "";
  @type("string") structureType: string = "housing";
  @type("int16") x: number = 0;
  @type("int16") y: number = 0;
  @type("string") operatorId: string = "";
}
