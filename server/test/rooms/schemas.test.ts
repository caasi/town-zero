import "../../src/polyfill.js";
import { describe, it, expect } from "vitest";
import { TileSchema } from "../../src/rooms/schemas/TileSchema.js";
import { StructureSchema } from "../../src/rooms/schemas/StructureSchema.js";
import { AgentSchema } from "../../src/rooms/schemas/AgentSchema.js";

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

describe("StructureSchema", () => {
  it("creates a structure with all fields", () => {
    const s = new StructureSchema();
    s.id = "vh1";
    s.type = "production";
    s.x = 10;
    s.y = 20;
    s.operatorId = "agent-1";

    expect(s.id).toBe("vh1");
    expect(s.type).toBe("production");
    expect(s.operatorId).toBe("agent-1");
  });

  it("uses empty string for no operator", () => {
    const s = new StructureSchema();
    s.operatorId = "";
    expect(s.operatorId).toBe("");
  });
});

describe("AgentSchema", () => {
  it("creates an agent with scalar fields", () => {
    const a = new AgentSchema();
    a.id = "agent-1";
    a.faction = "village-1";
    a.role = "farmer";
    a.x = 10;
    a.y = 20;
    a.hp = 100;
    a.maxHp = 100;
    a.state = "idle";
    a.controller = "player";
    a.currentTargetId = "";

    expect(a.id).toBe("agent-1");
    expect(a.hp).toBe(100);
    expect(a.state).toBe("idle");
    expect(a.currentTargetId).toBe("");
  });

  it("supports inventory as MapSchema", () => {
    const a = new AgentSchema();
    a.inventory.set("food", 5);
    a.inventory.set("material", 3);
    a.inventory.set("currency", 0);

    expect(a.inventory.get("food")).toBe(5);
    expect(a.inventory.get("material")).toBe(3);
    expect(a.inventory.get("currency")).toBe(0);
  });
});
