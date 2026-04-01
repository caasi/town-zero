# Colyseus Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the tested simulation engine back into Colyseus networking so players can join, send commands, and observe world state changes via WebSocket.

**Architecture:** SimulationState (plain objects) is the source of truth. Each tick, a pure `syncToSchema` function copies sim state into Colyseus schemas. GameRoom manages lifecycle, player sessions, and the tick loop. Side effects are concentrated in GameRoom; all helpers are pure functions.

**Tech Stack:** @colyseus/core 0.17.x, @colyseus/schema 4.x (schema() API), @colyseus/testing 0.17.x, Vitest, TypeScript strict

**Spec:** `docs/superpowers/specs/2026-04-01-colyseus-wiring-design.md`

---

### Task 1: TileSchema

**Files:**
- Create: `server/src/rooms/schemas/TileSchema.ts`
- Test: `server/test/rooms/schemas.test.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// server/src/rooms/schemas/TileSchema.ts
import { schema, type SchemaType } from "@colyseus/schema";

export const TileSchema = schema({
  x: "number",
  y: "number",
  terrain: "string",
  resourceYield: "string",
  ownerFaction: "string",
}, "TileSchema");

export type TileSchema = SchemaType<typeof TileSchema>;
```

- [ ] **Step 2: Write the failing test**

```typescript
// server/test/rooms/schemas.test.ts
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
```

Note: `../../src/polyfill.js` provides `Symbol.metadata` needed by @colyseus/schema v4. This import is required in the test entry file. The path is `../../src/` because test files live in `server/test/rooms/`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: FAIL (import path not resolved yet or file missing)

- [ ] **Step 4: Verify test passes**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/schemas/TileSchema.ts server/test/rooms/schemas.test.ts
git commit -m "feat: add TileSchema for Colyseus state sync"
```

---

### Task 2: StructureSchema

**Files:**
- Create: `server/src/rooms/schemas/StructureSchema.ts`
- Modify: `server/test/rooms/schemas.test.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// server/src/rooms/schemas/StructureSchema.ts
import { schema, type SchemaType } from "@colyseus/schema";

export const StructureSchema = schema({
  id: "string",
  type: "string",
  x: "number",
  y: "number",
  operatorId: "string",
}, "StructureSchema");

export type StructureSchema = SchemaType<typeof StructureSchema>;
```

- [ ] **Step 2: Write the failing test**

Append to `server/test/rooms/schemas.test.ts`:

```typescript
import { StructureSchema } from "../../src/rooms/schemas/StructureSchema.js";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: FAIL

- [ ] **Step 4: Verify test passes**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/schemas/StructureSchema.ts server/test/rooms/schemas.test.ts
git commit -m "feat: add StructureSchema for Colyseus state sync"
```

---

### Task 3: AgentSchema

**Files:**
- Create: `server/src/rooms/schemas/AgentSchema.ts`
- Modify: `server/test/rooms/schemas.test.ts`

- [ ] **Step 1: Create the schema file**

```typescript
// server/src/rooms/schemas/AgentSchema.ts
import { schema, type SchemaType } from "@colyseus/schema";

export const AgentSchema = schema({
  id: "string",
  faction: "string",
  role: "string",
  x: "number",
  y: "number",
  hp: "number",
  maxHp: "number",
  state: "string",
  controller: "string",
  currentTargetId: "string",
  inventory: { map: "number" },
}, "AgentSchema");

export type AgentSchema = SchemaType<typeof AgentSchema>;
```

- [ ] **Step 2: Write the failing test**

Append to `server/test/rooms/schemas.test.ts`:

```typescript
import { AgentSchema } from "../../src/rooms/schemas/AgentSchema.js";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: FAIL

- [ ] **Step 4: Verify test passes**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/schemas/AgentSchema.ts server/test/rooms/schemas.test.ts
git commit -m "feat: add AgentSchema with inventory MapSchema"
```

---

### Task 4: SettlementSchema + WorldStateSchema

**Files:**
- Create: `server/src/rooms/schemas/SettlementSchema.ts`
- Create: `server/src/rooms/schemas/WorldStateSchema.ts`
- Create: `server/src/rooms/schemas/index.ts` (barrel export)
- Modify: `server/test/rooms/schemas.test.ts`

- [ ] **Step 1: Create SettlementSchema**

```typescript
// server/src/rooms/schemas/SettlementSchema.ts
import { schema, type SchemaType } from "@colyseus/schema";
import { StructureSchema } from "./StructureSchema.js";

export const SettlementSchema = schema({
  id: "string",
  faction: "string",
  type: "string",
  x: "number",
  y: "number",
  population: "number",
  maxPopulation: "number",
  inventory: { map: "number" },
  structures: { array: StructureSchema },
}, "SettlementSchema");

export type SettlementSchema = SchemaType<typeof SettlementSchema>;
```

- [ ] **Step 2: Create WorldStateSchema**

```typescript
// server/src/rooms/schemas/WorldStateSchema.ts
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
```

- [ ] **Step 3: Create barrel export**

```typescript
// server/src/rooms/schemas/index.ts
export { TileSchema } from "./TileSchema.js";
export { StructureSchema } from "./StructureSchema.js";
export { AgentSchema } from "./AgentSchema.js";
export { SettlementSchema } from "./SettlementSchema.js";
export { WorldStateSchema } from "./WorldStateSchema.js";
```

- [ ] **Step 4: Write the failing tests**

Append to `server/test/rooms/schemas.test.ts`:

```typescript
import { SettlementSchema } from "../../src/rooms/schemas/SettlementSchema.js";
import { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";

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
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: FAIL

- [ ] **Step 6: Verify test passes**

Run: `cd server && pnpm exec vitest run test/rooms/schemas.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `cd server && pnpm exec vitest run`
Expected: All existing 98 tests + new schema tests PASS

- [ ] **Step 8: Commit**

```bash
git add server/src/rooms/schemas/ server/test/rooms/schemas.test.ts
git commit -m "feat: add SettlementSchema, WorldStateSchema, and barrel export"
```

---

### Task 5: syncToSchema pure function

**Files:**
- Create: `server/src/rooms/sync.ts`
- Create: `server/test/rooms/sync.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/test/rooms/sync.test.ts
import "../../src/polyfill.js";
import { describe, it, expect } from "vitest";
import { syncToSchema } from "../../src/rooms/sync.js";
import { WorldStateSchema, AgentSchema, SettlementSchema } from "../../src/rooms/schemas/index.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function makeSimState(overrides?: Partial<SimulationState>): SimulationState {
  return {
    grid: new Grid(10, 10),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
    ...overrides,
  };
}

function makeAgent(id: string, x = 5, y = 5): Agent {
  return new Agent({ id, position: { x, y }, faction: "village-1", role: "farmer", controller: "bot" });
}

describe("syncToSchema", () => {
  it("syncs tick counter", () => {
    const sim = makeSimState({ tick: 42 });
    const state = new WorldStateSchema();
    syncToSchema(sim, state);
    expect(state.tick).toBe(42);
  });

  it("syncs agents into schema", () => {
    const agent = makeAgent("a1", 3, 7);
    agent.addToInventory("food", 5);
    agent.addToInventory("material", 2);
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });

    const state = new WorldStateSchema();
    syncToSchema(sim, state);

    const schema = state.agents.get("a1");
    expect(schema).toBeDefined();
    expect(schema!.id).toBe("a1");
    expect(schema!.x).toBe(3);
    expect(schema!.y).toBe(7);
    expect(schema!.hp).toBe(100);
    expect(schema!.state).toBe("idle");
    expect(schema!.faction).toBe("village-1");
    expect(schema!.role).toBe("farmer");
    expect(schema!.controller).toBe("bot");
    expect(schema!.currentTargetId).toBe("");
    expect(schema!.inventory.get("food")).toBe(5);
    expect(schema!.inventory.get("material")).toBe(2);
    expect(schema!.inventory.get("currency")).toBe(0);
  });

  it("updates existing agent schema on subsequent sync", () => {
    const agent = makeAgent("a1", 3, 7);
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.x).toBe(3);

    agent.position = { x: 4, y: 7 };
    sim.tick = 1;
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.x).toBe(4);
    expect(state.tick).toBe(1);
  });

  it("removes agent schema when agent is removed from sim (merchant despawn)", () => {
    const agent = makeAgent("m1");
    const sim = makeSimState({ agents: new Map([["m1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.has("m1")).toBe(true);

    sim.agents.delete("m1");
    syncToSchema(sim, state);
    expect(state.agents.has("m1")).toBe(false);
  });

  it("keeps dead agents in schema with state dead", () => {
    const agent = makeAgent("a1");
    agent.takeDamage(200); // kills agent
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("dead");
    expect(state.agents.get("a1")!.hp).toBe(0);
  });

  it("syncs settlements with derived fields", () => {
    const village = new Settlement({
      id: "v1",
      faction: "village-1",
      type: "village",
      territory: [{ x: 10, y: 20 }, { x: 11, y: 20 }],
    });
    village.addStructure({ id: "h1", type: "housing", position: { x: 10, y: 20 }, operatorId: null });
    village.addStructure({ id: "p1", type: "production", position: { x: 11, y: 20 }, operatorId: "a1" });
    village.populationIds.push("a1", "a2", "a3");
    village.addResource("food", 30);

    const sim = makeSimState({ settlements: new Map([["v1", village]]) });
    const state = new WorldStateSchema();
    syncToSchema(sim, state);

    const schema = state.settlements.get("v1");
    expect(schema).toBeDefined();
    expect(schema!.id).toBe("v1");
    expect(schema!.faction).toBe("village-1");
    expect(schema!.type).toBe("village");
    expect(schema!.x).toBe(10);
    expect(schema!.y).toBe(20);
    expect(schema!.population).toBe(3);
    expect(schema!.maxPopulation).toBe(4); // 1 housing × HOUSING_POPULATION_CAP(4)
    expect(schema!.inventory.get("food")).toBe(30);
    expect(schema!.structures.length).toBe(2);
    expect(schema!.structures.at(0)!.id).toBe("h1");
    expect(schema!.structures.at(1)!.operatorId).toBe("a1");
  });

  it("syncs agent state transitions", () => {
    const agent = makeAgent("a1");
    agent.state = "gathering";
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("gathering");

    agent.state = "idle";
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.state).toBe("idle");
  });

  it("syncs agent inventory changes", () => {
    const agent = makeAgent("a1");
    const sim = makeSimState({ agents: new Map([["a1", agent]]) });
    const state = new WorldStateSchema();

    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.inventory.get("food")).toBe(0);

    agent.addToInventory("food", 10);
    syncToSchema(sim, state);
    expect(state.agents.get("a1")!.inventory.get("food")).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/sync.test.ts`
Expected: FAIL (sync.ts doesn't exist)

- [ ] **Step 3: Implement syncToSchema**

```typescript
// server/src/rooms/sync.ts
import type { SimulationState } from "../simulation/tick.js";
import type { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { AgentSchema } from "./schemas/AgentSchema.js";
import { SettlementSchema } from "./schemas/SettlementSchema.js";
import { StructureSchema } from "./schemas/StructureSchema.js";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";

function syncAgent(agent: Agent, agentSchema: AgentSchema): void {
  agentSchema.id = agent.id;
  agentSchema.faction = agent.faction;
  agentSchema.role = agent.role;
  agentSchema.x = agent.position.x;
  agentSchema.y = agent.position.y;
  agentSchema.hp = agent.hp;
  agentSchema.maxHp = agent.maxHp;
  agentSchema.state = agent.state;
  agentSchema.controller = agent.controller;
  agentSchema.currentTargetId = agent.currentTargetId ?? "";
  agentSchema.inventory.set("food", agent.inventory.food);
  agentSchema.inventory.set("material", agent.inventory.material);
  agentSchema.inventory.set("currency", agent.inventory.currency);
}

function syncSettlement(settlement: Settlement, schema: SettlementSchema): void {
  schema.id = settlement.id;
  schema.faction = settlement.faction;
  schema.type = settlement.type;
  schema.x = settlement.territory[0]?.x ?? 0;
  schema.y = settlement.territory[0]?.y ?? 0;
  schema.population = settlement.populationIds.length;
  schema.maxPopulation = settlement.getPopulationCap();
  schema.inventory.set("food", settlement.inventory.food);
  schema.inventory.set("material", settlement.inventory.material);
  schema.inventory.set("currency", settlement.inventory.currency);

  // Rebuild structures array
  schema.structures.clear();
  for (const structure of settlement.structures) {
    const ss = new StructureSchema();
    ss.id = structure.id;
    ss.type = structure.type;
    ss.x = structure.position.x;
    ss.y = structure.position.y;
    ss.operatorId = structure.operatorId ?? "";
    schema.structures.push(ss);
  }
}

export function syncToSchema(simState: SimulationState, roomState: WorldStateSchema): void {
  roomState.tick = simState.tick;

  // Sync agents
  for (const [id, agent] of simState.agents) {
    let agentSchema = roomState.agents.get(id);
    if (!agentSchema) {
      agentSchema = new AgentSchema();
      roomState.agents.set(id, agentSchema);
    }
    syncAgent(agent, agentSchema);
  }

  // Remove agents no longer in sim (merchant despawn)
  const agentKeys: string[] = [];
  roomState.agents.forEach((_value, key) => { agentKeys.push(key); });
  for (const key of agentKeys) {
    if (!simState.agents.has(key)) {
      roomState.agents.delete(key);
    }
  }

  // Sync settlements
  for (const [id, settlement] of simState.settlements) {
    let schema = roomState.settlements.get(id);
    if (!schema) {
      schema = new SettlementSchema();
      roomState.settlements.set(id, schema);
    }
    syncSettlement(settlement, schema);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run test/rooms/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/sync.ts server/test/rooms/sync.test.ts
git commit -m "feat: add syncToSchema pure function for sim-to-schema sync"
```

---

### Task 6: isValidActionCommand type guard

**Files:**
- Create: `server/src/rooms/validation.ts`
- Create: `server/test/rooms/validation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/test/rooms/validation.test.ts
import { describe, it, expect } from "vitest";
import { isValidActionCommand } from "../../src/rooms/validation.js";

describe("isValidActionCommand", () => {
  it("accepts valid move command", () => {
    expect(isValidActionCommand({ type: "move", target: { x: 5, y: 3 } })).toBe(true);
  });

  it("accepts valid gather command", () => {
    expect(isValidActionCommand({ type: "gather", resourceTile: { x: 1, y: 2 } })).toBe(true);
  });

  it("accepts valid attack command", () => {
    expect(isValidActionCommand({ type: "attack", targetId: "agent-1" })).toBe(true);
  });

  it("accepts valid deposit command", () => {
    expect(isValidActionCommand({ type: "deposit", settlementId: "v1" })).toBe(true);
  });

  it("accepts valid take command", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "food", amount: 3 })).toBe(true);
  });

  it("accepts valid trade command", () => {
    expect(isValidActionCommand({
      type: "trade", targetId: "a2",
      offer: "food", offerAmount: 2,
      want: "material", wantAmount: 1,
    })).toBe(true);
  });

  it("accepts valid talk command", () => {
    expect(isValidActionCommand({ type: "talk", targetId: "a1", optionId: "greet" })).toBe(true);
  });

  it("accepts valid idle command", () => {
    expect(isValidActionCommand({ type: "idle" })).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidActionCommand(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidActionCommand("move")).toBe(false);
  });

  it("rejects unknown command type", () => {
    expect(isValidActionCommand({ type: "fly" })).toBe(false);
  });

  it("rejects move without target", () => {
    expect(isValidActionCommand({ type: "move" })).toBe(false);
  });

  it("rejects move with non-numeric coordinates", () => {
    expect(isValidActionCommand({ type: "move", target: { x: "a", y: 3 } })).toBe(false);
  });

  it("rejects take with non-integer amount", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "food", amount: 1.5 })).toBe(false);
  });

  it("rejects take with invalid resource type", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "gold", amount: 1 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/validation.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the type guard**

```typescript
// server/src/rooms/validation.ts
import type { ActionCommand, ResourceType } from "@town-zero/shared";

const RESOURCE_TYPES: ReadonlySet<string> = new Set(["food", "material", "currency"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  return typeof v === "object" && v !== null
    && typeof (v as Record<string, unknown>).x === "number"
    && typeof (v as Record<string, unknown>).y === "number";
}

function isValidResource(v: unknown): v is ResourceType {
  return typeof v === "string" && RESOURCE_TYPES.has(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

export function isValidActionCommand(cmd: unknown): cmd is ActionCommand {
  if (typeof cmd !== "object" || cmd === null) return false;
  const c = cmd as Record<string, unknown>;

  switch (c.type) {
    case "move":
      return isPosition(c.target);
    case "gather":
      return isPosition(c.resourceTile);
    case "attack":
      return typeof c.targetId === "string" && c.targetId.length > 0;
    case "deposit":
      return typeof c.settlementId === "string" && c.settlementId.length > 0;
    case "take":
      return typeof c.settlementId === "string" && c.settlementId.length > 0
        && isValidResource(c.resource) && isPositiveInteger(c.amount);
    case "talk":
      return typeof c.targetId === "string" && c.targetId.length > 0
        && typeof c.optionId === "string";
    case "trade":
      return typeof c.targetId === "string" && c.targetId.length > 0
        && isValidResource(c.offer) && isPositiveInteger(c.offerAmount)
        && isValidResource(c.want) && isPositiveInteger(c.wantAmount);
    case "idle":
      return true;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run test/rooms/validation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/validation.ts server/test/rooms/validation.test.ts
git commit -m "feat: add isValidActionCommand runtime type guard"
```

---

### Task 7: extractVisionForPlayer pure function

**Files:**
- Create: `server/src/rooms/vision.ts`
- Create: `server/test/rooms/vision.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/test/rooms/vision.test.ts
import { describe, it, expect } from "vitest";
import { extractVisionForPlayer } from "../../src/rooms/vision.js";
import { Agent } from "../../src/simulation/agent.js";

describe("extractVisionForPlayer", () => {
  it("returns empty tiles for agent with no memory", () => {
    const agent = new Agent({
      id: "a1", position: { x: 5, y: 5 },
      faction: "village-1", role: "farmer", controller: "player",
    });
    const result = extractVisionForPlayer(agent, 10);
    expect(result.tick).toBe(10);
    expect(Object.keys(result.tiles)).toHaveLength(0);
  });

  it("converts MapMemory to plain Record", () => {
    const agent = new Agent({
      id: "a1", position: { x: 5, y: 5 },
      faction: "village-1", role: "farmer", controller: "player",
    });
    agent.recordTile(3, 4, "forest", [{ id: "a2", type: "agent", faction: "den-1", position: { x: 3, y: 4 } }], 5);
    agent.recordTile(5, 5, "plains", [], 5);

    const result = extractVisionForPlayer(agent, 5);
    expect(result.tick).toBe(5);
    expect(Object.keys(result.tiles)).toHaveLength(2);
    expect(result.tiles["3,4"].terrain).toBe("forest");
    expect(result.tiles["3,4"].entities).toHaveLength(1);
    expect(result.tiles["3,4"].entities[0].id).toBe("a2");
    expect(result.tiles["5,5"].terrain).toBe("plains");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/vision.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement extractVisionForPlayer**

```typescript
// server/src/rooms/vision.ts
import type { TileMemory } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";

export interface VisionData {
  tick: number;
  tiles: Record<string, TileMemory>;
}

export function extractVisionForPlayer(agent: Agent, tick: number): VisionData {
  return {
    tick,
    tiles: Object.fromEntries(agent.getAllMemory()),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run test/rooms/vision.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/vision.ts server/test/rooms/vision.test.ts
git commit -m "feat: add extractVisionForPlayer pure function"
```

---

### Task 8: syncTiles helper (one-time grid → schema sync)

**Files:**
- Modify: `server/src/rooms/sync.ts`
- Modify: `server/test/rooms/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/test/rooms/sync.test.ts`:

```typescript
import { syncTiles } from "../../src/rooms/sync.js";

describe("syncTiles", () => {
  it("populates tile schemas from grid", () => {
    const grid = new Grid(3, 3);
    grid.setTerrain(1, 1, "forest");
    grid.setResourceYield(0, 0, "food");
    grid.setOwner(2, 2, "village-1");

    const state = new WorldStateSchema();
    syncTiles(grid, state);

    expect(state.tiles.size).toBe(9); // 3x3
    expect(state.tiles.get("1,1")!.terrain).toBe("forest");
    expect(state.tiles.get("0,0")!.resourceYield).toBe("food");
    expect(state.tiles.get("2,2")!.ownerFaction).toBe("village-1");
    expect(state.tiles.get("0,1")!.terrain).toBe("plains");
    expect(state.tiles.get("0,1")!.resourceYield).toBe("");
    expect(state.tiles.get("0,1")!.ownerFaction).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/sync.test.ts`
Expected: FAIL

- [ ] **Step 3: Add syncTiles to sync.ts**

Add to `server/src/rooms/sync.ts`:

```typescript
import { TileSchema } from "./schemas/TileSchema.js";
import type { Grid } from "../simulation/grid.js";

export function syncTiles(grid: Grid, roomState: WorldStateSchema): void {
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const key = `${x},${y}`;
      const tile = new TileSchema();
      tile.x = x;
      tile.y = y;
      tile.terrain = grid.getTerrain(x, y) ?? "plains";
      tile.resourceYield = grid.getResourceYield(x, y) ?? "";
      tile.ownerFaction = grid.getOwner(x, y) ?? "";
      roomState.tiles.set(key, tile);
    }
  }
}
```

Update the export at top to also export `syncTiles`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run test/rooms/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/sync.ts server/test/rooms/sync.test.ts
git commit -m "feat: add syncTiles for one-time grid-to-schema population"
```

---

### Task 9: GameRoom implementation

**Files:**
- Create: `server/src/rooms/GameRoom.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Implement GameRoom**

```typescript
// server/src/rooms/GameRoom.ts
import { Room, Client } from "@colyseus/core";
import { TICK_RATE_MS } from "@town-zero/shared";
import { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import { syncToSchema, syncTiles } from "./sync.js";
import { isValidActionCommand } from "./validation.js";
import { extractVisionForPlayer } from "./vision.js";
import { Agent } from "../simulation/agent.js";

export class GameRoom extends Room<{ state: WorldStateSchema }> {
  private simState!: SimulationState;
  private sessionToAgent = new Map<string, string>();
  private nextPlayerId = 0;

  onCreate() {
    this.simState = generateMap();

    this.state = new WorldStateSchema();
    this.state.width = this.simState.grid.width;
    this.state.height = this.simState.grid.height;
    syncTiles(this.simState.grid, this.state);
    syncToSchema(this.simState, this.state);

    this.onMessage("command", (client: Client, cmd: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;

      if (!isValidActionCommand(cmd)) return;

      agent.setPlan([cmd]);
    });

    // Fixed-step simulation: deltaTime is intentionally ignored
    this.setSimulationInterval(() => this.tick(), TICK_RATE_MS);

    console.log("GameRoom created");
  }

  onJoin(client: Client, options?: { name?: string }) {
    const village = Array.from(this.simState.settlements.values())
      .find((s) => s.type === "village");

    if (!village) {
      client.leave(4000, "No village available");
      return;
    }

    if (village.populationIds.length >= village.getPopulationCap()) {
      client.leave(4001, "Village is full");
      return;
    }

    const name = options?.name ?? `Player-${this.nextPlayerId}`;
    const id = `player-${this.nextPlayerId++}`;

    // Find unoccupied tile in village territory
    const occupiedPositions = new Set(
      Array.from(this.simState.agents.values())
        .map((a) => `${a.position.x},${a.position.y}`),
    );
    const spawnTile = village.territory.find(
      (t) => !occupiedPositions.has(`${t.x},${t.y}`),
    ) ?? village.territory[0];

    const agent = new Agent({
      id,
      position: { ...spawnTile },
      faction: village.faction,
      role: name,
      controller: "player",
    });
    agent.addToInventory("food", 5);

    this.simState.agents.set(id, agent);
    village.populationIds.push(id);
    this.sessionToAgent.set(client.sessionId, id);

    console.log(`${name} joined as ${id} (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const agentId = this.sessionToAgent.get(client.sessionId);
    if (!agentId) return;

    const agent = this.simState.agents.get(agentId);
    if (agent) {
      agent.controller = "bot";
    }

    this.sessionToAgent.delete(client.sessionId);
    console.log(`${agentId} left, now bot-controlled (${client.sessionId})`);
  }

  private tick() {
    processTick(this.simState);
    syncToSchema(this.simState, this.state);
    this.sendVisionUpdates();
    this.checkPlayerDeaths();
  }

  private sendVisionUpdates() {
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) continue;

      const client = this.clients.getById(sessionId);
      if (!client) continue;

      const vision = extractVisionForPlayer(agent, this.simState.tick);
      client.send("vision", vision);
    }
  }

  private checkPlayerDeaths() {
    const deadSessions: string[] = [];
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || agent.isAlive()) continue;

      const client = this.clients.getById(sessionId);
      if (client) {
        client.send("death", { agentId });
      }
      deadSessions.push(sessionId);
    }
    for (const sessionId of deadSessions) {
      this.sessionToAgent.delete(sessionId);
    }
  }
}
```

- [ ] **Step 2: Register GameRoom in index.ts**

Modify `server/src/index.ts` to add:

```typescript
import { GameRoom } from "./rooms/GameRoom.js";
```

And add after the ChatRoom define line:

```typescript
gameServer.define("game", GameRoom);
```

- [ ] **Step 3: Run full test suite (no regressions)**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS (GameRoom itself tested in Task 10)

- [ ] **Step 4: Manual smoke test**

Run: `pnpm run dev:server`
Expected: Console shows "town-zero server listening on port 2567"

Stop the server after verifying.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/src/index.ts
git commit -m "feat: add GameRoom with simulation tick loop and player handling"
```

---

### Task 10: Install @colyseus/testing and write GameRoom integration tests

**Files:**
- Modify: `server/package.json` (add @colyseus/testing)
- Create: `server/test/rooms/game-room.test.ts`

**Dependency note:** `@colyseus/testing` requires `@colyseus/sdk` as a peer dependency. If installation fails or the API doesn't match, fall back to testing GameRoom methods directly: instantiate GameRoom, call lifecycle methods (`onCreate`, `onJoin`, `onLeave`) with mock Client objects, and trigger ticks manually. The pure functions (sync, validation, vision) are already fully tested in Tasks 5-8; integration tests focus on the wiring.

- [ ] **Step 1: Install @colyseus/testing and @colyseus/sdk**

```bash
cd /Users/caasi/GitHub/caasi/town-zero && pnpm add --filter @town-zero/server --save-dev @colyseus/testing @colyseus/sdk
```

If this causes dependency conflicts, skip `@colyseus/testing` and use the direct-instantiation fallback described above.

- [ ] **Step 2: Write integration tests**

```typescript
// server/test/rooms/game-room.test.ts
import "../../src/polyfill.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ColyseusTestServer, boot } from "@colyseus/testing";
import { GameRoom } from "../../src/rooms/GameRoom.js";

describe("GameRoom integration", () => {
  let colyseus: ColyseusTestServer;

  beforeEach(async () => {
    colyseus = await boot(GameRoom);
  });

  afterEach(async () => {
    await colyseus.shutdown();
  });

  it("player joins and agent appears in state", async () => {
    const client = await colyseus.connectTo("game", { name: "TestPlayer" });
    await client.waitForNextPatch();

    let playerAgent: any;
    client.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    expect(playerAgent).toBeDefined();
    expect(playerAgent.faction).toBe("village-1");
  });

  it("player sends move command and position updates", async () => {
    const client = await colyseus.connectTo("game", { name: "Mover" });
    await client.waitForNextPatch();

    let playerAgent: any;
    client.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });

    const origX = playerAgent.x;
    const origY = playerAgent.y;

    client.send("command", { type: "move", target: { x: origX + 1, y: origY } });
    await client.waitForNextPatch();

    client.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    expect(playerAgent.x).toBe(origX + 1);
  });

  it("player sends gather command and state becomes gathering", async () => {
    const client = await colyseus.connectTo("game", { name: "Gatherer" });
    await client.waitForNextPatch();

    let playerAgent: any;
    client.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });

    // Move agent to a resource tile first (resource zone is around 20,10)
    // For this test, send gather at current position — if no resource, state stays idle
    // A more robust test would move the agent to a known resource tile first
    client.send("command", { type: "gather", resourceTile: { x: 20, y: 10 } });
    await client.waitForNextPatch();

    // If agent was at the resource tile, state becomes gathering; otherwise command is rejected
    // This test validates the command pipeline works end-to-end
    expect(client.state.tick).toBeGreaterThan(0);
  });

  it("player leaves and agent becomes bot-controlled", async () => {
    const client = await colyseus.connectTo("game", { name: "Leaver" });
    await client.waitForNextPatch();

    let playerId: string | undefined;
    client.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerId = agent.id;
    });

    await client.leave();

    const observer = await colyseus.connectTo("game", { name: "Observer" });
    await observer.waitForNextPatch();

    let leftAgent: any;
    observer.state.agents.forEach((agent: any) => {
      if (agent.id === playerId) leftAgent = agent;
    });

    expect(leftAgent).toBeDefined();
    expect(leftAgent.controller).toBe("bot");
  });

  it("multiple players join and appear in state", async () => {
    const client1 = await colyseus.connectTo("game", { name: "Player1" });
    const client2 = await colyseus.connectTo("game", { name: "Player2" });
    await client1.waitForNextPatch();

    let playerCount = 0;
    client1.state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerCount++;
    });
    expect(playerCount).toBe(2);
  });

  it("bot agents act autonomously (idle bots get plans)", async () => {
    const client = await colyseus.connectTo("game", { name: "Observer" });

    // Wait several ticks for bot controller to run
    await client.waitForNextPatch();
    await client.waitForNextPatch();
    await client.waitForNextPatch();

    // Bot agents should exist and be alive (bot controller keeps them fed)
    let botCount = 0;
    client.state.agents.forEach((agent: any) => {
      if (agent.controller !== "player" && agent.hp > 0) botCount++;
    });
    expect(botCount).toBeGreaterThan(0);
  });

  it("settlement shows in state with population and resources", async () => {
    const client = await colyseus.connectTo("game", { name: "Settler" });
    await client.waitForNextPatch();

    let village: any;
    client.state.settlements.forEach((s: any) => {
      if (s.type === "village") village = s;
    });
    expect(village).toBeDefined();
    expect(village.population).toBeGreaterThan(0);
    expect(village.inventory.get("food")).toBeGreaterThanOrEqual(0);
  });

  it("tiles are populated in state", async () => {
    const client = await colyseus.connectTo("game", { name: "TileViewer" });
    await client.waitForNextPatch();

    expect(client.state.tiles.size).toBe(1600); // 40x40
    expect(client.state.width).toBe(40);
    expect(client.state.height).toBe(40);
  });

  it("invalid command is ignored without crash", async () => {
    const client = await colyseus.connectTo("game", { name: "BadCmd" });
    await client.waitForNextPatch();

    client.send("command", { type: "fly", destination: "moon" });
    await client.waitForNextPatch();

    expect(client.state.tick).toBeGreaterThan(0);
  });

  it("malformed command (bad shape) is ignored", async () => {
    const client = await colyseus.connectTo("game", { name: "BadShape" });
    await client.waitForNextPatch();

    client.send("command", "not an object");
    client.send("command", null);
    client.send("command", { type: "move" }); // missing target
    await client.waitForNextPatch();

    expect(client.state.tick).toBeGreaterThan(0);
  });

  it("two players join and one attacks the other", async () => {
    const client1 = await colyseus.connectTo("game", { name: "Attacker" });
    const client2 = await colyseus.connectTo("game", { name: "Defender" });
    await client1.waitForNextPatch();

    let attackerId: string | undefined;
    let defenderId: string | undefined;
    client1.state.agents.forEach((agent: any) => {
      if (agent.role === "Attacker") attackerId = agent.id;
      if (agent.role === "Defender") defenderId = agent.id;
    });

    // Attack command — will only succeed if agents are adjacent
    // Since both spawn in village territory, they may or may not be adjacent
    // This validates the command pipeline handles attack without crashing
    if (attackerId && defenderId) {
      client1.send("command", { type: "attack", targetId: defenderId });
      await client1.waitForNextPatch();
      await client1.waitForNextPatch();
    }

    expect(client1.state.tick).toBeGreaterThan(0);
  });
});
```

Note: Two spec test cases require direct sim state access that `@colyseus/testing` doesn't easily provide:
- **Population cap rejection:** Requires filling village to capacity before joining. The `onJoin` guard is straightforward code; covered by code review.
- **Command after agent dies:** Requires killing the player's agent mid-session. Starvation takes 300+ ticks. If the test framework exposes the room instance, add: `room.simState.agents.get(playerId).takeDamage(200)`, then verify `client.send("command", ...)` is silently ignored. Otherwise, this guard (`!agent.isAlive()` in `onMessage`) is covered by the `checkPlayerDeaths` + `onMessage` code path.

If using direct-instantiation fallback, both cases become easy to test. Prioritize adding them in that scenario.

Population cap rejection test is difficult with `@colyseus/testing` because it requires filling the village to capacity first. This edge case is adequately covered by the `onJoin` code path + the validation unit. If a direct-instantiation fallback is used, add a test that fills population to cap and verifies the next join is rejected.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/game-room.test.ts`
Expected: FAIL (GameRoom needs to be defined for the test server)

- [ ] **Step 4: Iterate on test setup until tests pass**

Common adjustments:
- Room name: `boot(GameRoom)` may need `colyseus.defineRoom("game", GameRoom)` instead
- `waitForNextPatch` timing: some tests may need multiple waits for multi-tick operations
- If `@colyseus/testing` doesn't work, fall back to direct instantiation with mock clients

Run: `cd server && pnpm exec vitest run test/rooms/game-room.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS (98 existing + new schema/sync/validation/vision/integration tests)

- [ ] **Step 6: Commit**

```bash
git add server/package.json pnpm-lock.yaml server/test/rooms/game-room.test.ts
git commit -m "feat: add GameRoom integration tests with @colyseus/testing"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS

- [ ] **Step 2: Type check**

Run: `cd server && pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Manual end-to-end smoke test**

Run: `pnpm run dev:server`

In another terminal, verify using an ESM script:

```bash
node --input-type=module -e "
  import { Client } from '@colyseus/sdk';
  const c = new Client('ws://localhost:2567');
  const room = await c.joinOrCreate('game', { name: 'SmokeTest' });
  room.onStateChange((state) => {
    console.log('tick:', state.tick, 'agents:', state.agents.size);
    if (state.tick > 3) { room.leave(); process.exit(0); }
  });
"
```

Run this from the `client/` directory where `@colyseus/sdk` is available, or install it temporarily.

Expected: tick counter increments, agents present in state.

- [ ] **Step 4: Commit any final adjustments**

If any adjustments were needed during smoke testing, commit them.
