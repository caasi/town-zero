import "../../src/polyfill.js";
import { describe, it, expect } from "vitest";
import { TileSchema } from "../../src/rooms/schemas/TileSchema.js";
import { StructureSchema } from "../../src/rooms/schemas/StructureSchema.js";
import { AgentSchema } from "../../src/rooms/schemas/AgentSchema.js";
import { SettlementSchema } from "../../src/rooms/schemas/SettlementSchema.js";
import { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";

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

    expect(a.id).toBe("agent-1");
    expect(a.hp).toBe(100);
    expect(a.state).toBe("idle");
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

describe("SettlementSchema", () => {
  it("creates settlement with nested structures", () => {
    const s = new SettlementSchema();
    s.id = "village-1";
    s.faction = "village-1";
    s.type = "village";
    s.x = 10;
    s.y = 20;
    s.population = 5;
    s.maxPopulation = 8;

    const st = new StructureSchema();
    st.id = "vh1";
    st.type = "housing";
    st.x = 10;
    st.y = 20;
    st.operatorId = "";
    s.structures.push(st);

    expect(s.structures.length).toBe(1);
    expect(s.structures.at(0)!.id).toBe("vh1");
  });

  it("supports settlement inventory", () => {
    const s = new SettlementSchema();
    s.inventory.set("food", 30);
    s.inventory.set("material", 10);
    expect(s.inventory.get("food")).toBe(30);
  });
});

describe("WorldStateSchema", () => {
  it("holds tick, dimensions, and all sub-schemas", () => {
    const w = new WorldStateSchema();
    w.tick = 42;
    w.width = 40;
    w.height = 40;

    const a = new AgentSchema();
    a.id = "agent-1";
    w.agents.set("agent-1", a);

    const s = new SettlementSchema();
    s.id = "village-1";
    w.settlements.set("village-1", s);

    const t = new TileSchema();
    t.x = 0;
    t.y = 0;
    t.terrain = "plains";
    w.tiles.set("0,0", t);

    expect(w.tick).toBe(42);
    expect(w.width).toBe(40);
    expect(w.agents.get("agent-1")!.id).toBe("agent-1");
    expect(w.settlements.get("village-1")!.id).toBe("village-1");
    expect(w.tiles.get("0,0")!.terrain).toBe("plains");
  });
});
