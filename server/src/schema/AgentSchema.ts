import { Schema, type } from "@colyseus/schema";

export class AgentSchema extends Schema {
  @type("string") id: string = "";
  @type("int16") x: number = 0;
  @type("int16") y: number = 0;
  @type("string") faction: string = "";
  @type("string") role: string = "";
  @type("int16") hp: number = 100;
  @type("int16") maxHp: number = 100;
  @type("int32") food: number = 0;
  @type("int32") material: number = 0;
  @type("int32") currency: number = 0;
  @type("string") state: string = "idle";
  @type("string") controller: string = "llm";
}
