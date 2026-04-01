import { Schema, type } from "@colyseus/schema";

export class TileSchema extends Schema {
  @type("uint8") x: number = 0;
  @type("uint8") y: number = 0;
  @type("string") terrain: string = "plains";
  @type("string") owner: string = "";
  @type("string") resourceYield: string = "";
}
