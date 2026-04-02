# Multi-Tile Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make settlements visually occupy multiple tiles on the world map, with each building (zone) visible on its own tile, following a RimWorld-style dual-layer model where zones overlay terrain.

**Architecture:** Add `ZoneType` enum and `zoneType` field to the tile data model (both simulation `Grid` and Colyseus `TileSchema`). Replace hardcoded `rect()` territory with template-based stamping in the map generator. Replace single-tile `drawSettlement()` with per-tile zone overlay rendering.

**Tech Stack:** TypeScript, Colyseus @colyseus/schema v4 (`schema()` API), Canvas 2D, Vitest

**Spec:** `docs/superpowers/specs/2026-04-03-multi-tile-settlement-design.md`

**DO NOT TOUCH:** Movement system (active development on separate branch). No changes to agent movement, pathfinding, or collision.

---

### File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `shared/src/constants.ts` | Add `ZoneType` enum |
| Modify | `shared/src/types.ts` | Expand `StructureType` to include `"core"` |
| Modify | `server/src/simulation/grid.ts` | Add `zoneType` to `TileData`, add `getZoneType()`/`setZoneType()` |
| Modify | `server/src/rooms/schemas/TileSchema.ts` | Add `zoneType` field |
| Modify | `server/src/rooms/sync.ts` | Sync `zoneType` in `syncTiles()`, change settlement `x,y` to core position in `syncSettlement()` |
| Create | `server/src/map/templates.ts` | Settlement layout templates (village 5×5, den 4×4) |
| Modify | `server/src/map/generator.ts` | Replace `rect()` + manual `addStructure()` with template stamping |
| Modify | `client/src/renderer.ts` | Replace `drawSettlement()` with per-tile `drawZoneOverlay()` |
| Modify | `server/test/simulation/grid.test.ts` | Tests for `getZoneType()`/`setZoneType()` |
| Create | `server/test/map/templates.test.ts` | Tests for template validity and stamping |
| Modify | `server/test/map/generator.test.ts` | Update tests for template-based generation |
| Modify | `server/test/rooms/sync.test.ts` | Tests for `zoneType` sync and core-based settlement `x,y` |

---

### Task 1: Add ZoneType Enum and Expand StructureType

**Files:**
- Modify: `shared/src/constants.ts:17-21`
- Modify: `shared/src/types.ts:61`

- [ ] **Step 1: Add ZoneType enum to constants.ts**

Add after the Settlement section comment (after line 21):

```typescript
// --- Zone ---
export enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
  PRODUCTION = "production",
}
```

- [ ] **Step 2: Expand StructureType in types.ts**

Change line 61 from:

```typescript
export type StructureType = "housing" | "production";
```

to:

```typescript
export type StructureType = "housing" | "production" | "core";
```

- [ ] **Step 3: Verify build**

Run: `pnpm run build`
Expected: Clean build, no errors. The new enum and type are exported via `shared/src/index.ts` barrel (`export * from "./constants.js"` and `export * from "./types.js"` already exist).

- [ ] **Step 4: Commit**

```bash
git add shared/src/constants.ts shared/src/types.ts
git commit -m "feat: add ZoneType enum and expand StructureType with core"
```

---

### Task 2: Add zoneType to Grid Data Model

**Files:**
- Modify: `server/src/simulation/grid.ts:3-7,17-21`
- Test: `server/test/simulation/grid.test.ts`

- [ ] **Step 1: Write failing tests for getZoneType/setZoneType**

Add to `server/test/simulation/grid.test.ts` inside the `describe("Grid")` block:

```typescript
it("defaults zoneType to empty string", () => {
  const grid = new Grid(10, 10);
  expect(grid.getZoneType(5, 5)).toBe("");
});

it("gets and sets zoneType", () => {
  const grid = new Grid(10, 10);
  grid.setZoneType(3, 4, "housing");
  expect(grid.getZoneType(3, 4)).toBe("housing");
});

it("returns empty string for out-of-bounds zoneType", () => {
  const grid = new Grid(10, 10);
  expect(grid.getZoneType(-1, 0)).toBe("");
  expect(grid.getZoneType(10, 0)).toBe("");
});

it("ignores setZoneType for out-of-bounds", () => {
  const grid = new Grid(10, 10);
  grid.setZoneType(-1, 0, "core");
  // No crash, no effect
  expect(grid.getZoneType(-1, 0)).toBe("");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --run server/test/simulation/grid.test.ts`
Expected: FAIL — `getZoneType` is not a function.

- [ ] **Step 3: Add zoneType to TileData and Grid**

In `server/src/simulation/grid.ts`:

Add `zoneType` to `TileData` interface (line 3-7):

```typescript
interface TileData {
  terrain: TerrainType;
  owner: string | null;
  resourceYield: ResourceType | null;
  zoneType: string;
}
```

Add `zoneType: ""` to the initializer in the constructor (line 17-21):

```typescript
this.tiles = Array.from({ length: width * height }, () => ({
  terrain: "plains" as TerrainType,
  owner: null,
  resourceYield: null,
  zoneType: "",
}));
```

Add accessor methods after `setResourceYield` (after line 60):

```typescript
getZoneType(x: number, y: number): string {
  if (!this.inBounds(x, y)) return "";
  return this.tiles[this.index(x, y)].zoneType;
}

setZoneType(x: number, y: number, zoneType: string): void {
  if (!this.inBounds(x, y)) return;
  this.tiles[this.index(x, y)].zoneType = zoneType;
}
```

Note: `getZoneType` returns `""` (not `null`) for out-of-bounds to match `ZoneType.EMPTY`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --run server/test/simulation/grid.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/grid.ts server/test/simulation/grid.test.ts
git commit -m "feat: add zoneType field to Grid TileData"
```

---

### Task 3: Add zoneType to TileSchema and Sync

**Files:**
- Modify: `server/src/rooms/schemas/TileSchema.ts:3-9`
- Modify: `server/src/rooms/sync.ts:87-100`
- Test: `server/test/rooms/sync.test.ts:156-174`

- [ ] **Step 1: Write failing test for zoneType sync**

Add to `server/test/rooms/sync.test.ts` inside the `describe("syncTiles")` block:

```typescript
it("syncs zoneType from grid", () => {
  const grid = new Grid(3, 3);
  grid.setZoneType(1, 1, "core");
  grid.setZoneType(0, 1, "housing");

  const state = new WorldStateSchema();
  syncTiles(grid, state);

  expect(state.tiles.get("1,1")!.zoneType).toBe("core");
  expect(state.tiles.get("0,1")!.zoneType).toBe("housing");
  expect(state.tiles.get("0,0")!.zoneType).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run server/test/rooms/sync.test.ts`
Expected: FAIL — `zoneType` property does not exist on TileSchema.

- [ ] **Step 3: Add zoneType to TileSchema**

In `server/src/rooms/schemas/TileSchema.ts`, add `zoneType` field:

```typescript
export const TileSchema = schema({
  x: "number",
  y: "number",
  terrain: "string",
  resourceYield: "string",
  ownerFaction: "string",
  zoneType: "string",
}, "TileSchema");
```

- [ ] **Step 4: Add zoneType sync to syncTiles()**

In `server/src/rooms/sync.ts`, add after line 96 (`tile.ownerFaction = ...`):

```typescript
tile.zoneType = grid.getZoneType(x, y);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --run server/test/rooms/sync.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/schemas/TileSchema.ts server/src/rooms/sync.ts server/test/rooms/sync.test.ts
git commit -m "feat: add zoneType to TileSchema and syncTiles"
```

---

### Task 4: Change Settlement x,y to Core Position in Sync

**Files:**
- Modify: `server/src/rooms/sync.ts:27-50`
- Test: `server/test/rooms/sync.test.ts:97-126`

- [ ] **Step 1: Write failing test for core-based settlement position**

Add to `server/test/rooms/sync.test.ts` inside `describe("syncToSchema")`:

```typescript
it("syncs settlement x,y from core structure position", () => {
  const village = new Settlement({
    id: "v1",
    faction: "village-1",
    type: "village",
    territory: [{ x: 8, y: 18 }, { x: 9, y: 19 }, { x: 10, y: 20 }],
  });
  village.addStructure({ id: "vc1", type: "core", position: { x: 10, y: 20 }, operatorId: null });
  village.addStructure({ id: "vh1", type: "housing", position: { x: 9, y: 19 }, operatorId: null });

  const sim = makeSimState({ settlements: new Map([["v1", village]]) });
  const state = new WorldStateSchema();
  syncToSchema(sim, state);

  const schema = state.settlements.get("v1")!;
  // x,y should be core position (10,20), not territory[0] (8,18)
  expect(schema.x).toBe(10);
  expect(schema.y).toBe(20);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- --run server/test/rooms/sync.test.ts`
Expected: FAIL — x is 8 (territory[0]) instead of 10 (core position).

- [ ] **Step 3: Change syncSettlement to use core position**

In `server/src/rooms/sync.ts`, replace lines 31-32:

```typescript
schema.x = settlement.territory[0]?.x ?? 0;
schema.y = settlement.territory[0]?.y ?? 0;
```

with:

```typescript
const core = settlement.structures.find((s) => s.type === "core");
schema.x = core?.position.x ?? settlement.territory[0]?.x ?? 0;
schema.y = core?.position.y ?? settlement.territory[0]?.y ?? 0;
```

The fallback to `territory[0]` ensures backward compatibility if a settlement somehow has no core (shouldn't happen, but safe).

- [ ] **Step 4: Update existing settlement sync test**

The existing test at line 97-126 creates a settlement without a core structure. The sync change has a fallback to `territory[0]` so the test would still pass, but update it to include a core for correctness. Replace the existing `"syncs settlements with derived fields"` test body:

```typescript
it("syncs settlements with derived fields", () => {
  const village = new Settlement({
    id: "v1",
    faction: "village-1",
    type: "village",
    territory: [{ x: 10, y: 20 }, { x: 11, y: 20 }],
  });
  village.addStructure({ id: "c1", type: "core", position: { x: 10, y: 20 }, operatorId: null });
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
  expect(schema!.x).toBe(10);  // core position
  expect(schema!.y).toBe(20);
  expect(schema!.population).toBe(3);
  expect(schema!.maxPopulation).toBe(4); // 1 housing × HOUSING_POPULATION_CAP(4)
  expect(schema!.inventory.get("food")).toBe(30);
  expect(schema!.structures.length).toBe(3); // core + housing + production
  expect(schema!.structures.at(0)!.id).toBe("c1");
  expect(schema!.structures.at(1)!.id).toBe("h1");
  expect(schema!.structures.at(2)!.operatorId).toBe("a1");
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- --run server/test/rooms/sync.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/sync.ts server/test/rooms/sync.test.ts
git commit -m "feat: sync settlement x,y from core structure position"
```

---

### Task 5: Create Settlement Templates

**Files:**
- Create: `server/src/map/templates.ts`
- Create: `server/test/map/templates.test.ts`

- [ ] **Step 1: Write tests for template validity**

Create `server/test/map/templates.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ZoneType } from "@town-zero/shared";
import {
  VILLAGE_TEMPLATE,
  DEN_TEMPLATE,
  findCore,
  stampTemplate,
} from "../../src/map/templates.js";
import { Grid } from "../../src/simulation/grid.js";

describe("Settlement Templates", () => {
  it("VILLAGE_TEMPLATE has exactly one CORE", () => {
    let coreCount = 0;
    for (const row of VILLAGE_TEMPLATE) {
      for (const cell of row) {
        if (cell === ZoneType.CORE) coreCount++;
      }
    }
    expect(coreCount).toBe(1);
  });

  it("DEN_TEMPLATE has exactly one CORE", () => {
    let coreCount = 0;
    for (const row of DEN_TEMPLATE) {
      for (const cell of row) {
        if (cell === ZoneType.CORE) coreCount++;
      }
    }
    expect(coreCount).toBe(1);
  });

  it("findCore returns core row and col", () => {
    const { row, col } = findCore(VILLAGE_TEMPLATE);
    expect(VILLAGE_TEMPLATE[row][col]).toBe(ZoneType.CORE);
  });
});

describe("stampTemplate", () => {
  it("stamps template onto grid setting ownerFaction and zoneType", () => {
    const grid = new Grid(20, 20);
    const template = [
      [ZoneType.EMPTY, ZoneType.HOUSING],
      [ZoneType.CORE, ZoneType.PRODUCTION],
    ];
    const result = stampTemplate(grid, template, 10, 10, "village-1");

    // Core is at [1][0], so world position = (10 + 0 - 0, 10 + 1 - 1) = (10, 10)
    expect(grid.getZoneType(10, 10)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(11, 9)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(11, 10)).toBe(ZoneType.PRODUCTION);
    expect(grid.getZoneType(10, 9)).toBe(ZoneType.EMPTY);

    // All tiles have ownerFaction set
    expect(grid.getOwner(10, 10)).toBe("village-1");
    expect(grid.getOwner(11, 9)).toBe("village-1");
    expect(grid.getOwner(10, 9)).toBe("village-1");

    // Returns territory and structures
    expect(result.territory).toHaveLength(4);
    expect(result.structures).toHaveLength(3); // core + housing + production
    const core = result.structures.find((s) => s.type === "core");
    expect(core).toBeDefined();
    expect(core!.id).toBe("village-1-core-10-10"); // deterministic ID from faction + zone + position
  });

  it("clips template at grid edges", () => {
    const grid = new Grid(5, 5);
    const template = [
      [ZoneType.HOUSING, ZoneType.CORE, ZoneType.HOUSING],
    ];
    // Core at [0][1], place at world (4, 2) → housing would be at (3,2), (4,2), (5,2)
    // (5,2) is out of bounds
    const result = stampTemplate(grid, template, 4, 2, "test");

    expect(grid.getZoneType(4, 2)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(3, 2)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(5, 2)).toBe(""); // out of bounds, not set
    expect(result.territory).toHaveLength(2); // only in-bounds tiles
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --run server/test/map/templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement templates.ts**

Create `server/src/map/templates.ts`:

```typescript
import { ZoneType } from "@town-zero/shared";
import type { Position, StructureType } from "@town-zero/shared";
import type { Grid } from "../simulation/grid.js";

// --- Templates ---

const _ = ZoneType.EMPTY;
const C = ZoneType.CORE;
const H = ZoneType.HOUSING;
const P = ZoneType.PRODUCTION;

export const VILLAGE_TEMPLATE: ZoneType[][] = [
  [_, P, _, H, _],
  [_, _, _, _, _],
  [_, H, C, P, _],
  [_, _, _, _, _],
  [_, _, _, _, _],
];

// Den is intentionally smaller than village (4×4 vs 5×5)
export const DEN_TEMPLATE: ZoneType[][] = [
  [_, H, _, _],
  [_, C, P, _],
  [_, _, _, _],
  [_, _, _, _],
];

// --- Helpers ---

export function findCore(template: ZoneType[][]): { row: number; col: number } {
  for (let row = 0; row < template.length; row++) {
    for (let col = 0; col < template[row].length; col++) {
      if (template[row][col] === ZoneType.CORE) return { row, col };
    }
  }
  throw new Error("Template has no CORE cell");
}

interface StampResult {
  territory: Position[];
  structures: { id: string; type: StructureType; position: Position; operatorId: null }[];
}

export function stampTemplate(
  grid: Grid,
  template: ZoneType[][],
  coreX: number,
  coreY: number,
  faction: string,
): StampResult {
  const { row: coreRow, col: coreCol } = findCore(template);
  const territory: Position[] = [];
  const structures: StampResult["structures"] = [];

  for (let row = 0; row < template.length; row++) {
    for (let col = 0; col < template[row].length; col++) {
      const worldX = coreX + (col - coreCol);
      const worldY = coreY + (row - coreRow);

      if (!grid.inBounds(worldX, worldY)) continue;

      const zone = template[row][col];
      grid.setOwner(worldX, worldY, faction);
      grid.setZoneType(worldX, worldY, zone);
      territory.push({ x: worldX, y: worldY });

      if (zone !== ZoneType.EMPTY) {
        // Deterministic ID from faction + grid position
        structures.push({
          id: `${faction}-${zone}-${worldX}-${worldY}`,
          type: zone as StructureType,
          position: { x: worldX, y: worldY },
          operatorId: null,
        });
      }
    }
  }

  return { territory, structures };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- --run server/test/map/templates.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/map/templates.ts server/test/map/templates.test.ts
git commit -m "feat: add settlement layout templates with stampTemplate"
```

---

### Task 6: Rewrite Map Generator to Use Templates

**Files:**
- Modify: `server/src/map/generator.ts:66-131`
- Modify: `server/test/map/generator.test.ts`

- [ ] **Step 1: Write new generator tests for template-based layout**

Add to `server/test/map/generator.test.ts`:

```typescript
it("village has a core structure", () => {
  const state = generateMap();
  const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
  expect(village.structures.some((s) => s.type === "core")).toBe(true);
});

it("den has a core structure", () => {
  const state = generateMap();
  const den = Array.from(state.settlements.values()).find((s) => s.type === "den")!;
  expect(den.structures.some((s) => s.type === "core")).toBe(true);
});

it("sets zoneType on grid tiles for village territory", () => {
  const state = generateMap();
  const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
  const core = village.structures.find((s) => s.type === "core")!;
  expect(state.grid.getZoneType(core.position.x, core.position.y)).toBe("core");
});

it("sets ownerFaction on all village territory tiles", () => {
  const state = generateMap();
  const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
  for (const pos of village.territory) {
    expect(state.grid.getOwner(pos.x, pos.y)).toBe(village.faction);
  }
});
```

- [ ] **Step 2: Run tests to see which fail**

Run: `pnpm run test -- --run server/test/map/generator.test.ts`
Expected: New tests about core structure FAIL (no core in current generator). Existing tests should still pass.

- [ ] **Step 3: Rewrite village creation in generator.ts**

Replace lines 66-83 (village section) with:

```typescript
import { stampTemplate, VILLAGE_TEMPLATE, DEN_TEMPLATE } from "./templates.js";

// Village
const villageStamp = stampTemplate(grid, VILLAGE_TEMPLATE, villageCx, villageCy, "village-1");
const village = new Settlement({
  id: "village-1",
  faction: "village-1",
  type: "village",
  territory: villageStamp.territory,
});
for (const structure of villageStamp.structures) {
  village.addStructure(structure);
}
village.addResource("food", 30);
village.addResource("material", 10);
settlements.set("village-1", village);
```

Keep the `rect()` helper function (lines 8-20) — it's still used for resource tile generation at line 57.

- [ ] **Step 4: Rewrite den creation in generator.ts**

Replace lines 100-116 (den section) with:

```typescript
// Monster den
const denStamp = stampTemplate(grid, DEN_TEMPLATE, denCx, denCy, "den-1");
const den = new Settlement({
  id: "den-1",
  faction: "den-1",
  type: "den",
  territory: denStamp.territory,
});
for (const structure of denStamp.structures) {
  den.addStructure(structure);
}
den.addResource("food", 20);
den.addResource("material", 5);
settlements.set("den-1", den);
```

- [ ] **Step 5: Adjust NPC spawn positions**

The existing NPC spawn code uses hardcoded offsets from `villageCx`/`denCx` (e.g., `villageCx + (i % 3) - 1`). Since the core is at `villageCx, villageCy` (center of template), NPC offsets are relative to the core position. Some NPCs may land on zone tiles (core, housing, production) — this is acceptable for MVP since all zone tiles are walkable. Verify NPCs fall within the stamped territory bounds. The village template is 5×5 with core at [2][2], so offsets of ±2 from center are within bounds.

- [ ] **Step 6: Run all tests**

Run: `pnpm run test -- --run server/test/map/generator.test.ts`
Expected: ALL PASS (both old and new tests)

- [ ] **Step 7: Run full test suite**

Run: `pnpm run test`
Expected: ALL PASS — no regressions in other test files.

- [ ] **Step 8: Commit**

```bash
git add server/src/map/generator.ts server/test/map/generator.test.ts
git commit -m "feat: rewrite map generator to use settlement templates"
```

---

### Task 7: Replace drawSettlement with Zone Overlay Rendering

**Files:**
- Modify: `client/src/renderer.ts:62-73,104-147,189-202`

This task has no automated tests (Canvas 2D rendering). Verify visually by running the client.

- [ ] **Step 1: Add zone overlay rendering to drawTile**

In `client/src/renderer.ts`, modify `drawTile()` (lines 104-147). After the terrain pattern drawing (line 126) and before the fog overlay (line 142), add zone overlay rendering:

First, refactor the tile lookup at lines 111-117 to extract the `tile` variable to a wider scope so it can be reused. Change:

```typescript
let terrain = "plains";
let resourceYield = "";
if (state?.tiles) {
  const tile = state.tiles.get(`${x},${y}`);
  if (tile) {
    terrain = tile.terrain || "plains";
    resourceYield = tile.resourceYield || "";
  }
}
```

to:

```typescript
const tile = state?.tiles?.get(`${x},${y}`);
const terrain = tile?.terrain || "plains";
const resourceYield = tile?.resourceYield || "";
```

Then add zone overlay code after the terrain pattern (after line 126), before the resource yield dot:

```typescript
// Zone overlay (after terrain pattern, before fog)
if (fogLevel !== "unknown") {
  const zoneType = tile?.zoneType || "";
  const ownerFaction = tile?.ownerFaction || "";

  if (zoneType) {
    this.drawZoneOverlay(ctx, px, py, zoneType, ownerFaction);
  } else if (ownerFaction) {
    // Empty territory tile — subtle border
    this.drawTerritoryBorder(ctx, px, py, ownerFaction);
  }
}
```

- [ ] **Step 2: Add drawZoneOverlay method**

Add after `drawTerrainPattern()` (after line 187):

```typescript
private drawZoneOverlay(
  ctx: CanvasRenderingContext2D, px: number, py: number,
  zoneType: string, ownerFaction: string,
): void {
  const isVillage = ownerFaction.startsWith("village");
  const factionColor = isVillage ? "#d4a037" : "#8a4a8a";

  let fillColor: string;
  let marker: string;
  let opacity: number;

  switch (zoneType) {
    case "core":
      fillColor = factionColor;
      marker = "\u2605"; // ★
      opacity = 0.6;
      break;
    case "housing":
      fillColor = "#c4843a";
      marker = "H";
      opacity = 0.5;
      break;
    case "production":
      fillColor = "#5a9e4b";
      marker = "P";
      opacity = 0.5;
      break;
    default:
      return;
  }

  ctx.globalAlpha = opacity;
  ctx.fillStyle = fillColor;
  ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(marker, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
}

private drawTerritoryBorder(
  ctx: CanvasRenderingContext2D, px: number, py: number,
  ownerFaction: string,
): void {
  const isVillage = ownerFaction.startsWith("village");
  const color = isVillage ? "#d4a037" : "#8a4a8a";
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.globalAlpha = 1;
}
```

- [ ] **Step 3: Delete drawSettlement method and its call site**

Remove the settlement rendering loop (lines 62-73 in `draw()`):

```typescript
// Delete this entire block:
if (state?.settlements) {
  state.settlements.forEach((s: any) => {
    ...
  });
}
```

Remove the `drawSettlement()` method (lines 189-202).

- [ ] **Step 4: Verify visually**

Run: `pnpm run dev:server` and `pnpm run dev:client` in parallel.
Open `http://localhost:3000` in browser.
Expected:
- Village and den appear as multi-tile layouts on the map
- Each zone tile has a colored overlay with letter marker (★ for core, H for housing, P for production)
- Empty territory tiles have a subtle faction-colored border
- Fog of war still works correctly (explored zones dimmed, unknown zones hidden)
- Agents still render on top of zones

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer.ts
git commit -m "feat: replace single-tile settlement marker with per-tile zone overlay"
```

---

### Task 8: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: ALL PASS

- [ ] **Step 2: Run build**

Run: `pnpm run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Manual verification**

Run server and client, verify:
- Settlement zones visible on map
- Core shows ★ marker
- Housing shows H, Production shows P
- Territory borders visible on empty tiles
- Fog of war works on zone tiles
- Agents render correctly on top of zone tiles
- HUD still shows settlement info
- No console errors

- [ ] **Step 4: Commit any final fixes if needed**
