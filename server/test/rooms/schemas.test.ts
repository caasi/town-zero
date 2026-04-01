import "../../src/polyfill.js";
import { describe, it, expect } from "vitest";
import { TileSchema } from "../../src/rooms/schemas/TileSchema.js";

describe("TileSchema", () => {
  it("creates a tile with default values", () => {
    const tile = new TileSchema();
    tile.x = 5;
    tile.y = 10;
    tile.terrain = "forest";
    tile.resourceYield = "food";
    tile.ownerFaction = "village-1";

    expect(tile.x).toBe(5);
    expect(tile.y).toBe(10);
    expect(tile.terrain).toBe("forest");
    expect(tile.resourceYield).toBe("food");
    expect(tile.ownerFaction).toBe("village-1");
  });

  it("uses empty string for no resource yield", () => {
    const tile = new TileSchema();
    tile.resourceYield = "";
    expect(tile.resourceYield).toBe("");
  });
});
