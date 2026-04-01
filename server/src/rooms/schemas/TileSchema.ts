import { schema, type SchemaType } from "@colyseus/schema";

export const TileSchema = schema({
  x: "number",
  y: "number",
  terrain: "string",
  resourceYield: "string",
  ownerFaction: "string",
}, "TileSchema");

export type TileSchema = SchemaType<typeof TileSchema>;
