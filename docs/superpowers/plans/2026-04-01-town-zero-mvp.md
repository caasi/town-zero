# town-zero MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable multiplayer ecosystem simulation .io game with LLM-driven NPCs, grid-based world, settlement economy, and Canvas 2D client.

**Architecture:** Settlement-centric model where villages and monster dens share the same abstraction. Unified ActionCommand interface for all entities (players, NPCs, bots). Colyseus handles state sync; simulation runs server-side at 1-2 tick/s. LLM drives NPC decisions via natural language prompt → structured JSON response.

**Tech Stack:** TypeScript, Colyseus 0.17.x, @colyseus/schema 2.x, Canvas 2D, Vite, Vitest

---

## File Structure

```
town-zero/
├── package.json                          # npm workspaces root
├── tsconfig.base.json                    # shared TS config
├── .gitignore
├── shared/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── types.ts                      # Resource, TerrainType, ActionCommand, FSMState
│       ├── constants.ts                  # balance constants (tick rate, vision radius, etc.)
│       └── index.ts                      # barrel export
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                      # entry point, starts Colyseus server
│   │   ├── schema/
│   │   │   ├── TileSchema.ts             # Colyseus Schema for grid tiles
│   │   │   ├── AgentSchema.ts            # Colyseus Schema for agents
│   │   │   ├── SettlementSchema.ts       # Colyseus Schema for settlements
│   │   │   ├── StructureSchema.ts        # Colyseus Schema for structures
│   │   │   └── WorldState.ts             # Root state schema
│   │   ├── simulation/
│   │   │   ├── grid.ts                   # Grid class, tile access, neighbors, pathfinding
│   │   │   ├── agent.ts                  # Agent logic, inventory ops, FSM transitions
│   │   │   ├── settlement.ts             # Settlement logic, production, population
│   │   │   ├── commands.ts               # ActionCommand validation & execution
│   │   │   ├── combat.ts                 # Attack resolution, damage, death
│   │   │   ├── resources.ts              # Gather, deposit, take, consumption
│   │   │   ├── vision.ts                 # Vision radius, MapMemory update, merge
│   │   │   └── tick.ts                   # Main simulation tick loop
│   │   ├── ai/
│   │   │   ├── llm-scheduler.ts          # Round-robin LLM call scheduling
│   │   │   ├── prompt-builder.ts         # MapMemory + state → natural language
│   │   │   ├── response-parser.ts        # LLM JSON → ActionCommand[]
│   │   │   └── bot-controller.ts         # Simple rule-based bot for disconnected players
│   │   ├── dialogue/
│   │   │   ├── dialogue-engine.ts        # Dialogue tree traversal and execution
│   │   │   ├── dialogue-gate.ts          # LLM y/n call for request nodes
│   │   │   └── trees/
│   │   │       └── villager-basic.json   # Example dialogue tree data
│   │   ├── map/
│   │   │   └── generator.ts             # Initial map layout generation
│   │   └── rooms/
│   │       └── GameRoom.ts              # Colyseus Room handler
│   └── test/
│       ├── simulation/
│       │   ├── grid.test.ts
│       │   ├── agent.test.ts
│       │   ├── settlement.test.ts
│       │   ├── commands.test.ts
│       │   ├── combat.test.ts
│       │   ├── resources.test.ts
│       │   ├── vision.test.ts
│       │   └── tick.test.ts
│       ├── ai/
│       │   ├── prompt-builder.test.ts
│       │   ├── response-parser.test.ts
│       │   └── bot-controller.test.ts
│       ├── dialogue/
│       │   └── dialogue-engine.test.ts
│       └── map/
│           └── generator.test.ts
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/
    │   └── index.html
    └── src/
        ├── main.ts                       # Entry: connect to Colyseus, init renderer
        ├── renderer.ts                   # Canvas 2D grid + entity rendering
        ├── input.ts                      # Click handling, command construction
        ├── fog.ts                        # Fog of war display filtering
        └── ui.ts                         # HUD: inventory, settlement info, dialogue
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/index.ts`
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/public/index.html`, `client/src/main.ts`

- [ ] **Step 1: Create root `package.json` with workspaces**

```json
{
  "name": "town-zero",
  "private": true,
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev:server": "npm run dev --workspace=server",
    "dev:client": "npm run dev --workspace=client",
    "test": "npm run test --workspace=server",
    "build": "npm run build --workspaces"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
.superpowers/
*.tsbuildinfo
```

- [ ] **Step 4: Create `shared/` package**

`shared/package.json`:
```json
{
  "name": "@town-zero/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

`shared/src/index.ts`:
```typescript
export * from "./types.js";
export * from "./constants.js";
```

- [ ] **Step 5: Create `server/` package**

`server/package.json`:
```json
{
  "name": "@town-zero/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest watch"
  },
  "dependencies": {
    "@town-zero/shared": "*",
    "colyseus": "^0.17.8",
    "@colyseus/ws-transport": "^0.17.9",
    "@colyseus/schema": "^2.0.0",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0",
    "@types/express": "^5.0.0"
  }
}
```

`server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

`server/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
  },
});
```

`server/src/index.ts` (placeholder):
```typescript
console.log("town-zero server starting...");
```

- [ ] **Step 6: Create `client/` package**

`client/package.json`:
```json
{
  "name": "@town-zero/client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@town-zero/shared": "*",
    "@colyseus/sdk": "^0.17.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}
```

`client/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "bundler"
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

`client/vite.config.ts`:
```typescript
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { port: 3000 },
});
```

`client/public/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>town-zero</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #111; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`client/src/main.ts` (placeholder):
```typescript
const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const ctx = canvas.getContext("2d")!;
ctx.fillStyle = "#222";
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = "#0f0";
ctx.font = "24px monospace";
ctx.fillText("town-zero client ready", 20, 40);
```

- [ ] **Step 7: Install dependencies and verify**

Run: `npm install`
Expected: All packages installed, no errors.

Run: `npm test --workspace=server`
Expected: "No test files found" or vitest exits cleanly.

Run: `npm run dev --workspace=client`
Expected: Vite dev server starts on port 3000.

- [ ] **Step 8: Commit**

```bash
git add --all
git commit -m "chore: scaffold monorepo with shared/server/client workspaces"
```

---

## Task 2: Shared Types & Constants

**Files:**
- Create: `shared/src/types.ts`
- Create: `shared/src/constants.ts`

- [ ] **Step 1: Write `shared/src/types.ts`**

```typescript
// --- Resources ---

export type ResourceType = "food" | "material" | "currency";

export interface ResourceStore {
  food: number;
  material: number;
  currency: number;
}

export function emptyResourceStore(): ResourceStore {
  return { food: 0, material: 0, currency: 0 };
}

// --- Terrain ---

export type TerrainType = "plains" | "forest" | "mountain" | "water" | "road";

export const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  plains: 1,
  forest: 2,
  mountain: 3,
  water: Infinity, // impassable
  road: 1,
};

// --- Grid ---

export interface Position {
  x: number;
  y: number;
}

// --- FSM ---

export type FSMState =
  | "idle"
  | "moving"
  | "gathering"
  | "fighting"
  | "operating" // operating a production facility
  | "trading"
  | "talking"
  | "dead";

// --- ActionCommand ---

export type ActionCommand =
  | { type: "move"; target: Position }
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "talk"; targetId: string; optionId: string }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "idle" };

// --- Settlement ---

export type SettlementType = "village" | "den";
export type StructureType = "housing" | "production";

// --- Agent ---

export type ControllerType = "player" | "llm" | "bot";

// --- MapMemory ---

export interface EntitySnapshot {
  id: string;
  type: string;       // "agent" | "merchant" | "monster"
  faction: string;
  position: Position;
}

export interface TileMemory {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;   // tick when last observed
}

// --- Dialogue ---

export type DialogueNodeId = string;

export type DialogueNode =
  | { type: "text"; speaker: string; content: string; next: DialogueNodeId }
  | { type: "choice"; options: DialogueChoice[] }
  | { type: "request"; label: string; gateType: "llm"; nextYes: DialogueNodeId; nextNo: DialogueNodeId }
  | { type: "action"; effect: string; next: DialogueNodeId }
  | { type: "end" };

export interface DialogueChoice {
  label: string;
  next: DialogueNodeId;
  condition?: string; // expression evaluated against locals
}

export interface DialogueTree {
  id: string;
  root: DialogueNodeId;
  nodes: Record<DialogueNodeId, DialogueNode>;
  defaultLocals?: Record<string, unknown>; // initial per-instance local variables
}
```

- [ ] **Step 2: Write `shared/src/constants.ts`**

```typescript
// --- World ---
export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 40;
export const TICK_RATE_MS = 1000; // 1 tick per second

// --- Vision ---
export const DEFAULT_VISION_RADIUS = 5;
export const SCOUT_VISION_RADIUS = 8;

// --- Agent ---
export const DEFAULT_MAX_HP = 100;
export const FOOD_CONSUMPTION_INTERVAL = 30; // ticks between food consumption
export const STARVATION_DAMAGE = 10;         // HP lost per interval when starving
export const DEFAULT_INVENTORY_CAPACITY = 20;
export const GATHER_DURATION = 5;            // ticks to complete gathering

// --- Settlement ---
export const HOUSING_POPULATION_CAP = 4;     // population per housing structure
export const PRODUCTION_INPUT_COST = 2;      // raw materials consumed per production cycle
export const PRODUCTION_OUTPUT = 3;          // food/material produced per cycle
export const PRODUCTION_CYCLE_TICKS = 10;    // ticks per production cycle

// --- Combat ---
export const BASE_ATTACK_DAMAGE = 20;
export const ATTACK_COOLDOWN_TICKS = 3;

// --- Merchant ---
export const MERCHANT_SPAWN_INTERVAL = 120;  // ticks between merchant spawns
export const MERCHANT_TRADE_RATE = 2;        // food/material per currency

// --- LLM ---
export const LLM_CALL_INTERVAL_MS = 20_000; // 20 seconds default
export const LLM_MIN_INTERVAL_MS = 10_000;  // 10 seconds for important NPCs
export const LLM_MAX_INTERVAL_MS = 30_000;  // 30 seconds for common NPCs
```

- [ ] **Step 3: Build shared package and verify**

Run: `npm run build --workspace=shared`
Expected: Compiles to `shared/dist/` with no errors.

- [ ] **Step 4: Commit**

```bash
git add shared/src/types.ts shared/src/constants.ts
git commit -m "feat: add shared types and game balance constants"
```

---

## Task 3: Grid System

**Files:**
- Create: `server/src/simulation/grid.ts`
- Create: `server/test/simulation/grid.test.ts`

- [ ] **Step 1: Write failing grid tests**

`server/test/simulation/grid.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { Grid } from "../../src/simulation/grid.js";
import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";

describe("Grid", () => {
  it("creates grid with correct dimensions", () => {
    const grid = new Grid(GRID_WIDTH, GRID_HEIGHT);
    expect(grid.width).toBe(40);
    expect(grid.height).toBe(40);
  });

  it("gets and sets tile terrain", () => {
    const grid = new Grid(10, 10);
    grid.setTerrain(3, 4, "forest");
    expect(grid.getTerrain(3, 4)).toBe("forest");
  });

  it("returns null for out-of-bounds", () => {
    const grid = new Grid(10, 10);
    expect(grid.getTerrain(-1, 0)).toBeNull();
    expect(grid.getTerrain(10, 0)).toBeNull();
  });

  it("defaults all tiles to plains", () => {
    const grid = new Grid(5, 5);
    expect(grid.getTerrain(0, 0)).toBe("plains");
    expect(grid.getTerrain(4, 4)).toBe("plains");
  });

  it("returns cardinal neighbors", () => {
    const grid = new Grid(10, 10);
    const neighbors = grid.getNeighbors(5, 5);
    expect(neighbors).toHaveLength(4);
    expect(neighbors).toContainEqual({ x: 4, y: 5 });
    expect(neighbors).toContainEqual({ x: 6, y: 5 });
    expect(neighbors).toContainEqual({ x: 5, y: 4 });
    expect(neighbors).toContainEqual({ x: 5, y: 6 });
  });

  it("returns fewer neighbors at edges", () => {
    const grid = new Grid(10, 10);
    const neighbors = grid.getNeighbors(0, 0);
    expect(neighbors).toHaveLength(2);
  });

  it("checks adjacency", () => {
    const grid = new Grid(10, 10);
    expect(grid.isAdjacent({ x: 5, y: 5 }, { x: 5, y: 6 })).toBe(true);
    expect(grid.isAdjacent({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(false);
  });

  it("calculates manhattan distance", () => {
    const grid = new Grid(10, 10);
    expect(grid.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
  });

  it("gets/sets tile owner", () => {
    const grid = new Grid(10, 10);
    expect(grid.getOwner(5, 5)).toBeNull();
    grid.setOwner(5, 5, "village-1");
    expect(grid.getOwner(5, 5)).toBe("village-1");
  });

  it("gets/sets resource yield", () => {
    const grid = new Grid(10, 10);
    expect(grid.getResourceYield(5, 5)).toBeNull();
    grid.setResourceYield(5, 5, "food");
    expect(grid.getResourceYield(5, 5)).toBe("food");
  });

  it("finds tiles within radius", () => {
    const grid = new Grid(10, 10);
    const tiles = grid.getTilesInRadius({ x: 5, y: 5 }, 1);
    expect(tiles).toHaveLength(5); // center + 4 cardinal
    expect(tiles).toContainEqual({ x: 5, y: 5 });
  });

  it("clips radius at map edges", () => {
    const grid = new Grid(10, 10);
    const tiles = grid.getTilesInRadius({ x: 0, y: 0 }, 1);
    expect(tiles).toHaveLength(3); // (0,0), (1,0), (0,1)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: All tests FAIL — module not found.

- [ ] **Step 3: Implement `grid.ts`**

`server/src/simulation/grid.ts`:
```typescript
import type { Position, TerrainType, ResourceType } from "@town-zero/shared";

interface TileData {
  terrain: TerrainType;
  owner: string | null;
  resourceYield: ResourceType | null;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  private tiles: TileData[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = Array.from({ length: width * height }, () => ({
      terrain: "plains" as TerrainType,
      owner: null,
      resourceYield: null,
    }));
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTerrain(x: number, y: number): TerrainType | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].terrain;
  }

  setTerrain(x: number, y: number, terrain: TerrainType): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].terrain = terrain;
  }

  getOwner(x: number, y: number): string | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].owner;
  }

  setOwner(x: number, y: number, owner: string | null): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].owner = owner;
  }

  getResourceYield(x: number, y: number): ResourceType | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].resourceYield;
  }

  setResourceYield(x: number, y: number, resource: ResourceType | null): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].resourceYield = resource;
  }

  getNeighbors(x: number, y: number): Position[] {
    const dirs: Position[] = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];
    return dirs.filter((p) => this.inBounds(p.x, p.y));
  }

  isAdjacent(a: Position, b: Position): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  distance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getTilesInRadius(center: Position, radius: number): Position[] {
    const result: Position[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) {
          const x = center.x + dx;
          const y = center.y + dy;
          if (this.inBounds(x, y)) {
            result.push({ x, y });
          }
        }
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All grid tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/grid.ts server/test/simulation/grid.test.ts
git commit -m "feat: implement grid system with terrain, ownership, and spatial queries"
```

---

## Task 4: Agent Model

**Files:**
- Create: `server/src/simulation/agent.ts`
- Create: `server/test/simulation/agent.test.ts`

- [ ] **Step 1: Write failing agent tests**

`server/test/simulation/agent.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";

describe("Agent", () => {
  function makeAgent(overrides?: Partial<ConstructorParameters<typeof Agent>[0]>) {
    return new Agent({
      id: "agent-1",
      position: { x: 5, y: 5 },
      faction: "village-1",
      role: "farmer",
      controller: "llm",
      ...overrides,
    });
  }

  it("creates agent with default values", () => {
    const agent = makeAgent();
    expect(agent.id).toBe("agent-1");
    expect(agent.hp).toBe(100);
    expect(agent.state).toBe("idle");
    expect(agent.inventory).toEqual({ food: 0, material: 0, currency: 0 });
    expect(agent.plan).toEqual([]);
  });

  it("adds resources to inventory", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 5);
    expect(agent.inventory.food).toBe(5);
  });

  it("removes resources from inventory", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 5);
    expect(agent.removeFromInventory("food", 3)).toBe(true);
    expect(agent.inventory.food).toBe(2);
  });

  it("refuses to remove more than available", () => {
    const agent = makeAgent();
    agent.addToInventory("food", 2);
    expect(agent.removeFromInventory("food", 5)).toBe(false);
    expect(agent.inventory.food).toBe(2);
  });

  it("checks resource availability", () => {
    const agent = makeAgent();
    agent.addToInventory("material", 3);
    expect(agent.hasResource("material", 3)).toBe(true);
    expect(agent.hasResource("material", 4)).toBe(false);
  });

  it("takes damage and dies", () => {
    const agent = makeAgent();
    agent.takeDamage(80);
    expect(agent.hp).toBe(20);
    expect(agent.isAlive()).toBe(true);
    agent.takeDamage(30);
    expect(agent.hp).toBe(0);
    expect(agent.isAlive()).toBe(false);
    expect(agent.state).toBe("dead");
  });

  it("sets and clears plan", () => {
    const agent = makeAgent();
    agent.setPlan([{ type: "move", target: { x: 6, y: 5 } }, { type: "idle" }]);
    expect(agent.plan).toHaveLength(2);
    agent.clearPlan();
    expect(agent.plan).toHaveLength(0);
  });

  it("shifts next command from plan", () => {
    const agent = makeAgent();
    agent.setPlan([{ type: "move", target: { x: 6, y: 5 } }, { type: "idle" }]);
    const cmd = agent.shiftPlan();
    expect(cmd?.type).toBe("move");
    expect(agent.plan).toHaveLength(1);
  });

  it("returns undefined when plan is empty", () => {
    const agent = makeAgent();
    expect(agent.shiftPlan()).toBeUndefined();
  });

  it("records tile in map memory", () => {
    const agent = makeAgent();
    agent.recordTile(3, 4, "forest", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 3, y: 4 } }], 10);
    const mem = agent.getMemory(3, 4);
    expect(mem).not.toBeNull();
    expect(mem!.terrain).toBe("forest");
    expect(mem!.entities).toHaveLength(1);
    expect(mem!.timestamp).toBe(10);
  });

  it("returns null for unvisited tile", () => {
    const agent = makeAgent();
    expect(agent.getMemory(0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Agent tests FAIL — module not found.

- [ ] **Step 3: Implement `agent.ts`**

`server/src/simulation/agent.ts`:
```typescript
import type {
  Position,
  ResourceType,
  ResourceStore,
  FSMState,
  ActionCommand,
  ControllerType,
  EntitySnapshot,
  TileMemory,
  TerrainType,
} from "@town-zero/shared";
import { emptyResourceStore, DEFAULT_MAX_HP } from "@town-zero/shared";

interface AgentInit {
  id: string;
  position: Position;
  faction: string;
  role: string;
  controller: ControllerType;
  hp?: number;
}

export class Agent {
  readonly id: string;
  position: Position;
  faction: string;
  role: string;
  hp: number;
  maxHp: number;
  inventory: ResourceStore;
  state: FSMState;
  plan: ActionCommand[];
  controller: ControllerType;
  private mapMemory: Map<string, TileMemory>;

  // FSM execution state
  currentCommandTicks: number = 0;
  currentCommandTarget: number = 0;

  constructor(init: AgentInit) {
    this.id = init.id;
    this.position = { ...init.position };
    this.faction = init.faction;
    this.role = init.role;
    this.hp = init.hp ?? DEFAULT_MAX_HP;
    this.maxHp = init.hp ?? DEFAULT_MAX_HP;
    this.inventory = emptyResourceStore();
    this.state = "idle";
    this.plan = [];
    this.controller = init.controller;
    this.mapMemory = new Map();
  }

  addToInventory(resource: ResourceType, amount: number): void {
    this.inventory[resource] += amount;
  }

  removeFromInventory(resource: ResourceType, amount: number): boolean {
    if (this.inventory[resource] < amount) return false;
    this.inventory[resource] -= amount;
    return true;
  }

  hasResource(resource: ResourceType, amount: number): boolean {
    return this.inventory[resource] >= amount;
  }

  takeDamage(damage: number): void {
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.state = "dead";
      this.plan = [];
    }
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  setPlan(commands: ActionCommand[]): void {
    this.plan = [...commands];
  }

  clearPlan(): void {
    this.plan = [];
  }

  shiftPlan(): ActionCommand | undefined {
    return this.plan.shift();
  }

  // --- MapMemory ---

  private memoryKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  recordTile(x: number, y: number, terrain: TerrainType, entities: EntitySnapshot[], tick: number): void {
    this.mapMemory.set(this.memoryKey(x, y), { terrain, entities: [...entities], timestamp: tick });
  }

  getMemory(x: number, y: number): TileMemory | null {
    return this.mapMemory.get(this.memoryKey(x, y)) ?? null;
  }

  getAllMemory(): Map<string, TileMemory> {
    return this.mapMemory;
  }

  mergeMemory(other: Map<string, TileMemory>): void {
    for (const [key, otherMem] of other) {
      const existing = this.mapMemory.get(key);
      if (!existing || otherMem.timestamp > existing.timestamp) {
        this.mapMemory.set(key, { ...otherMem, entities: [...otherMem.entities] });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All agent tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/agent.test.ts
git commit -m "feat: implement agent model with inventory, HP, plan queue, and map memory"
```

---

## Task 5: Settlement Model

**Files:**
- Create: `server/src/simulation/settlement.ts`
- Create: `server/test/simulation/settlement.test.ts`

- [ ] **Step 1: Write failing settlement tests**

`server/test/simulation/settlement.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { Settlement, Structure } from "../../src/simulation/settlement.js";

describe("Settlement", () => {
  function makeSettlement() {
    return new Settlement({
      id: "village-1",
      faction: "village-1",
      type: "village",
      territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 6 }],
    });
  }

  it("creates settlement with empty inventory", () => {
    const s = makeSettlement();
    expect(s.inventory).toEqual({ food: 0, material: 0, currency: 0 });
  });

  it("checks if position is in territory", () => {
    const s = makeSettlement();
    expect(s.isInTerritory({ x: 5, y: 5 })).toBe(true);
    expect(s.isInTerritory({ x: 0, y: 0 })).toBe(false);
  });

  it("calculates population cap from housing", () => {
    const s = makeSettlement();
    expect(s.getPopulationCap()).toBe(0);
    s.addStructure({ id: "h1", type: "housing", position: { x: 5, y: 5 }, operatorId: null });
    expect(s.getPopulationCap()).toBe(4);
    s.addStructure({ id: "h2", type: "housing", position: { x: 5, y: 6 }, operatorId: null });
    expect(s.getPopulationCap()).toBe(8);
  });

  it("tracks production structures", () => {
    const s = makeSettlement();
    s.addStructure({ id: "p1", type: "production", position: { x: 6, y: 5 }, operatorId: null });
    expect(s.getProductionStructures()).toHaveLength(1);
  });

  it("adds and removes resources", () => {
    const s = makeSettlement();
    s.addResource("food", 10);
    expect(s.inventory.food).toBe(10);
    expect(s.removeResource("food", 5)).toBe(true);
    expect(s.inventory.food).toBe(5);
    expect(s.removeResource("food", 10)).toBe(false);
  });
});

describe("Structure", () => {
  it("assigns and clears operator", () => {
    const structure: Structure = { id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: null };
    expect(structure.operatorId).toBeNull();
    structure.operatorId = "agent-1";
    expect(structure.operatorId).toBe("agent-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Settlement tests FAIL.

- [ ] **Step 3: Implement `settlement.ts`**

`server/src/simulation/settlement.ts`:
```typescript
import type { Position, ResourceType, ResourceStore, SettlementType, StructureType } from "@town-zero/shared";
import { emptyResourceStore, HOUSING_POPULATION_CAP } from "@town-zero/shared";

export interface Structure {
  id: string;
  type: StructureType;
  position: Position;
  operatorId: string | null;
}

interface SettlementInit {
  id: string;
  faction: string;
  type: SettlementType;
  territory: Position[];
}

export class Settlement {
  readonly id: string;
  readonly faction: string;
  readonly type: SettlementType;
  inventory: ResourceStore;
  territory: Position[];
  structures: Structure[];
  populationIds: string[]; // agent IDs that belong to this settlement

  constructor(init: SettlementInit) {
    this.id = init.id;
    this.faction = init.faction;
    this.type = init.type;
    this.inventory = emptyResourceStore();
    this.territory = [...init.territory];
    this.structures = [];
    this.populationIds = [];
  }

  isInTerritory(pos: Position): boolean {
    return this.territory.some((t) => t.x === pos.x && t.y === pos.y);
  }

  addStructure(structure: Structure): void {
    this.structures.push(structure);
  }

  getPopulationCap(): number {
    return this.structures.filter((s) => s.type === "housing").length * HOUSING_POPULATION_CAP;
  }

  getProductionStructures(): Structure[] {
    return this.structures.filter((s) => s.type === "production");
  }

  addResource(resource: ResourceType, amount: number): void {
    this.inventory[resource] += amount;
  }

  removeResource(resource: ResourceType, amount: number): boolean {
    if (this.inventory[resource] < amount) return false;
    this.inventory[resource] -= amount;
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All settlement tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/settlement.ts server/test/simulation/settlement.test.ts
git commit -m "feat: implement settlement model with structures, territory, and resource management"
```

---

## Task 6: Command Validation & Execution

**Files:**
- Create: `server/src/simulation/commands.ts`
- Create: `server/test/simulation/commands.test.ts`

- [ ] **Step 1: Write failing command tests**

`server/test/simulation/commands.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { validateCommand, executeCommand, CommandContext } from "../../src/simulation/commands.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { ActionCommand } from "@town-zero/shared";

function makeContext(): CommandContext {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addResource("food", 10);
  const agents = new Map<string, Agent>([["a1", agent]]);
  const settlements = new Map<string, Settlement>([["v1", settlement]]);
  return { grid, agent, agents, settlements };
}

describe("validateCommand", () => {
  it("rejects move to impassable tile", () => {
    const ctx = makeContext();
    ctx.grid.setTerrain(6, 5, "water");
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts move to passable adjacent tile", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects move to non-adjacent tile", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "move", target: { x: 8, y: 8 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects gather on tile without resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "gather", resourceTile: { x: 5, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts gather on resource tile when agent is there", () => {
    const ctx = makeContext();
    ctx.agent.position = { x: 3, y: 3 };
    const cmd: ActionCommand = { type: "gather", resourceTile: { x: 3, y: 3 } };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects deposit when not in settlement territory", () => {
    const ctx = makeContext();
    ctx.agent.position = { x: 0, y: 0 };
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts deposit when in settlement territory", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects take when settlement lacks resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 100 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts take when settlement has resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 5 };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects attack on nonexistent target", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "attack", targetId: "nobody" };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });
});

describe("executeCommand", () => {
  it("move changes agent position", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    executeCommand(cmd, ctx);
    expect(ctx.agent.position).toEqual({ x: 6, y: 5 });
    expect(ctx.agent.state).toBe("idle");
  });

  it("deposit transfers agent inventory to settlement", () => {
    const ctx = makeContext();
    ctx.agent.addToInventory("material", 5);
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    executeCommand(cmd, ctx);
    expect(ctx.agent.inventory.material).toBe(0);
    expect(ctx.settlements.get("v1")!.inventory.material).toBe(5);
  });

  it("take transfers settlement inventory to agent", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 3 };
    executeCommand(cmd, ctx);
    expect(ctx.agent.inventory.food).toBe(3);
    expect(ctx.settlements.get("v1")!.inventory.food).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Command tests FAIL.

- [ ] **Step 3: Implement `commands.ts`**

`server/src/simulation/commands.ts`:
```typescript
import type { ActionCommand, ResourceType } from "@town-zero/shared";
import { TERRAIN_MOVE_COST } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";

export interface CommandContext {
  grid: Grid;
  agent: Agent;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
}

export function validateCommand(cmd: ActionCommand, ctx: CommandContext): boolean {
  const { grid, agent, agents, settlements } = ctx;

  switch (cmd.type) {
    case "move": {
      const terrain = grid.getTerrain(cmd.target.x, cmd.target.y);
      if (!terrain) return false;
      if (TERRAIN_MOVE_COST[terrain] === Infinity) return false;
      if (!grid.isAdjacent(agent.position, cmd.target)) return false;
      return true;
    }
    case "gather": {
      const resource = grid.getResourceYield(cmd.resourceTile.x, cmd.resourceTile.y);
      if (!resource) return false;
      if (agent.position.x !== cmd.resourceTile.x || agent.position.y !== cmd.resourceTile.y) return false;
      return true;
    }
    case "deposit": {
      const settlement = settlements.get(cmd.settlementId);
      if (!settlement) return false;
      if (!settlement.isInTerritory(agent.position)) return false;
      return true;
    }
    case "take": {
      const settlement = settlements.get(cmd.settlementId);
      if (!settlement) return false;
      if (!settlement.isInTerritory(agent.position)) return false;
      if (settlement.inventory[cmd.resource] < cmd.amount) return false;
      return true;
    }
    case "attack": {
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      return true;
    }
    case "trade": {
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      if (!agent.hasResource(cmd.offer, cmd.offerAmount)) return false;
      if (!target.hasResource(cmd.want, cmd.wantAmount)) return false;
      return true;
    }
    case "talk": {
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      return true;
    }
    case "idle":
      return true;
    default:
      return false;
  }
}

export function executeCommand(cmd: ActionCommand, ctx: CommandContext): void {
  const { agent, agents, settlements } = ctx;

  switch (cmd.type) {
    case "move":
      agent.position = { ...cmd.target };
      break;
    case "deposit": {
      const settlement = settlements.get(cmd.settlementId)!;
      for (const res of ["food", "material", "currency"] as ResourceType[]) {
        const amount = agent.inventory[res];
        if (amount > 0) {
          agent.removeFromInventory(res, amount);
          settlement.addResource(res, amount);
        }
      }
      break;
    }
    case "take": {
      const settlement = settlements.get(cmd.settlementId)!;
      settlement.removeResource(cmd.resource, cmd.amount);
      agent.addToInventory(cmd.resource, cmd.amount);
      break;
    }
    case "trade": {
      const target = agents.get(cmd.targetId)!;
      agent.removeFromInventory(cmd.offer, cmd.offerAmount);
      target.addToInventory(cmd.offer, cmd.offerAmount);
      target.removeFromInventory(cmd.want, cmd.wantAmount);
      agent.addToInventory(cmd.want, cmd.wantAmount);
      break;
    }
    case "idle":
      break;
    // gather, attack, talk handled by tick system (multi-tick)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All command tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/commands.ts server/test/simulation/commands.test.ts
git commit -m "feat: implement ActionCommand validation and single-tick execution"
```

---

## Task 7: Resource System (Gather, Production, Consumption)

**Files:**
- Create: `server/src/simulation/resources.ts`
- Create: `server/test/simulation/resources.test.ts`

- [ ] **Step 1: Write failing resource system tests**

`server/test/simulation/resources.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { processGathering, processProduction, processConsumption } from "../../src/simulation/resources.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { GATHER_DURATION, FOOD_CONSUMPTION_INTERVAL, STARVATION_DAMAGE, PRODUCTION_INPUT_COST, PRODUCTION_OUTPUT, PRODUCTION_CYCLE_TICKS } from "@town-zero/shared";

describe("processGathering", () => {
  it("increments gather progress each tick", () => {
    const grid = new Grid(10, 10);
    grid.setResourceYield(3, 3, "food");
    const agent = new Agent({ id: "a1", position: { x: 3, y: 3 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.state = "gathering";
    agent.currentCommandTicks = 0;
    agent.currentCommandTarget = GATHER_DURATION;

    processGathering(agent, grid);
    expect(agent.currentCommandTicks).toBe(1);
    expect(agent.state).toBe("gathering");
  });

  it("completes gathering and adds resource to inventory", () => {
    const grid = new Grid(10, 10);
    grid.setResourceYield(3, 3, "food");
    const agent = new Agent({ id: "a1", position: { x: 3, y: 3 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.state = "gathering";
    agent.currentCommandTicks = GATHER_DURATION - 1;
    agent.currentCommandTarget = GATHER_DURATION;

    processGathering(agent, grid);
    expect(agent.inventory.food).toBe(1);
    expect(agent.state).toBe("idle");
  });
});

describe("processProduction", () => {
  it("produces output when operator present and materials available", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: "a1" });
    settlement.addResource("material", PRODUCTION_INPUT_COST);

    const agents = new Map([["a1", new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" })]]);
    agents.get("a1")!.state = "operating";

    processProduction(settlement, agents, PRODUCTION_CYCLE_TICKS); // tick == cycle boundary
    expect(settlement.inventory.food).toBe(PRODUCTION_OUTPUT);
    expect(settlement.inventory.material).toBe(0);
  });

  it("does not produce without operator", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: null });
    settlement.addResource("material", 10);

    processProduction(settlement, new Map(), PRODUCTION_CYCLE_TICKS);
    expect(settlement.inventory.food).toBe(0);
  });

  it("does not produce without materials", () => {
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
    settlement.addStructure({ id: "p1", type: "production", position: { x: 0, y: 0 }, operatorId: "a1" });

    const agents = new Map([["a1", new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" })]]);
    agents.get("a1")!.state = "operating";

    processProduction(settlement, agents, PRODUCTION_CYCLE_TICKS);
    expect(settlement.inventory.food).toBe(0);
  });
});

describe("processConsumption", () => {
  it("consumes food from agent inventory at interval", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 5);

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL); // tick == consumption boundary
    expect(agent.inventory.food).toBe(4);
    expect(agent.hp).toBe(100);
  });

  it("does not consume on non-interval ticks", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 5);

    processConsumption(agent, 1); // not on interval
    expect(agent.inventory.food).toBe(5);
  });

  it("damages agent when starving", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
    // no food in inventory

    processConsumption(agent, FOOD_CONSUMPTION_INTERVAL);
    expect(agent.hp).toBe(100 - STARVATION_DAMAGE);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Resource tests FAIL.

- [ ] **Step 3: Implement `resources.ts`**

`server/src/simulation/resources.ts`:
```typescript
import { FOOD_CONSUMPTION_INTERVAL, STARVATION_DAMAGE, PRODUCTION_INPUT_COST, PRODUCTION_OUTPUT, PRODUCTION_CYCLE_TICKS } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";

export function processGathering(agent: Agent, grid: Grid): void {
  if (agent.state !== "gathering") return;

  agent.currentCommandTicks++;
  if (agent.currentCommandTicks >= agent.currentCommandTarget) {
    const resource = grid.getResourceYield(agent.position.x, agent.position.y);
    if (resource) {
      agent.addToInventory(resource, 1);
    }
    agent.state = "idle";
    agent.currentCommandTicks = 0;
    agent.currentCommandTarget = 0;
  }
}

export function processProduction(settlement: Settlement, agents: Map<string, Agent>, tick: number): void {
  if (tick % PRODUCTION_CYCLE_TICKS !== 0) return;

  for (const structure of settlement.getProductionStructures()) {
    if (!structure.operatorId) continue;

    const operator = agents.get(structure.operatorId);
    if (!operator || !operator.isAlive() || operator.state !== "operating") continue;

    if (settlement.removeResource("material", PRODUCTION_INPUT_COST)) {
      settlement.addResource("food", PRODUCTION_OUTPUT);
    }
  }
}

export function processConsumption(agent: Agent, tick: number): void {
  if (!agent.isAlive()) return;
  if (tick % FOOD_CONSUMPTION_INTERVAL !== 0) return;

  if (!agent.removeFromInventory("food", 1)) {
    agent.takeDamage(STARVATION_DAMAGE);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All resource tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/resources.ts server/test/simulation/resources.test.ts
git commit -m "feat: implement resource gathering, production, and consumption systems"
```

---

## Task 8: Combat System

**Files:**
- Create: `server/src/simulation/combat.ts`
- Create: `server/test/simulation/combat.test.ts`

- [ ] **Step 1: Write failing combat tests**

`server/test/simulation/combat.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { processCombat } from "../../src/simulation/combat.js";
import { Agent } from "../../src/simulation/agent.js";
import { BASE_ATTACK_DAMAGE } from "@town-zero/shared";

describe("processCombat", () => {
  it("deals damage to target", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });
    attacker.state = "fighting";

    processCombat(attacker, target);
    expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
  });

  it("kills target when HP reaches 0", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm", hp: 10 });
    attacker.state = "fighting";

    processCombat(attacker, target);
    expect(target.isAlive()).toBe(false);
    expect(target.state).toBe("dead");
  });

  it("does nothing if attacker is not fighting", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });

    processCombat(attacker, target);
    expect(target.hp).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Combat tests FAIL.

- [ ] **Step 3: Implement `combat.ts`**

`server/src/simulation/combat.ts`:
```typescript
import { BASE_ATTACK_DAMAGE, ATTACK_COOLDOWN_TICKS } from "@town-zero/shared";
import type { Agent } from "./agent.js";

export function processCombat(attacker: Agent, target: Agent): void {
  if (attacker.state !== "fighting") return;
  if (!target.isAlive()) return;

  target.takeDamage(BASE_ATTACK_DAMAGE);

  attacker.currentCommandTicks++;
  if (attacker.currentCommandTicks >= ATTACK_COOLDOWN_TICKS) {
    attacker.state = "idle";
    attacker.currentCommandTicks = 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All combat tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/combat.ts server/test/simulation/combat.test.ts
git commit -m "feat: implement combat system with damage and death"
```

---

## Task 9: Vision & MapMemory Update

**Files:**
- Create: `server/src/simulation/vision.ts`
- Create: `server/test/simulation/vision.test.ts`

- [ ] **Step 1: Write failing vision tests**

`server/test/simulation/vision.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { updateVision, mergeAdjacentMemories } from "../../src/simulation/vision.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { DEFAULT_VISION_RADIUS } from "@town-zero/shared";

describe("updateVision", () => {
  it("records tiles within vision radius", () => {
    const grid = new Grid(20, 20);
    grid.setTerrain(6, 5, "forest");
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const allAgents = new Map([["a1", agent]]);

    updateVision(agent, grid, allAgents, 10);

    const mem = agent.getMemory(6, 5);
    expect(mem).not.toBeNull();
    expect(mem!.terrain).toBe("forest");
    expect(mem!.timestamp).toBe(10);
  });

  it("does not record tiles outside vision radius", () => {
    const grid = new Grid(20, 20);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const allAgents = new Map([["a1", agent]]);

    updateVision(agent, grid, allAgents, 10);

    const farTile = agent.getMemory(5 + DEFAULT_VISION_RADIUS + 1, 5);
    expect(farTile).toBeNull();
  });

  it("includes other agents in entity snapshots", () => {
    const grid = new Grid(20, 20);
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const other = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "den-1", role: "beast", controller: "llm" });
    const allAgents = new Map([["a1", agent], ["a2", other]]);

    updateVision(agent, grid, allAgents, 10);

    const mem = agent.getMemory(6, 5);
    expect(mem!.entities).toHaveLength(1);
    expect(mem!.entities[0].id).toBe("a2");
  });
});

describe("mergeAdjacentMemories", () => {
  it("merges memories between adjacent agents of same faction", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "v1", role: "scout", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);
    b.recordTile(19, 19, "mountain", [], 8);

    mergeAdjacentMemories([a, b], grid);

    expect(a.getMemory(19, 19)).not.toBeNull();
    expect(b.getMemory(0, 0)).not.toBeNull();
  });

  it("does not merge between non-adjacent agents", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 8, y: 8 }, faction: "v1", role: "scout", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);
    b.recordTile(19, 19, "mountain", [], 8);

    mergeAdjacentMemories([a, b], grid);

    expect(a.getMemory(19, 19)).toBeNull();
    expect(b.getMemory(0, 0)).toBeNull();
  });

  it("does not merge between different factions", () => {
    const grid = new Grid(20, 20);
    const a = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    const b = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });

    a.recordTile(0, 0, "forest", [], 5);

    mergeAdjacentMemories([a, b], grid);

    expect(b.getMemory(0, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Vision tests FAIL.

- [ ] **Step 3: Implement `vision.ts`**

`server/src/simulation/vision.ts`:
```typescript
import { DEFAULT_VISION_RADIUS, SCOUT_VISION_RADIUS } from "@town-zero/shared";
import type { EntitySnapshot } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";

function getVisionRadius(agent: Agent): number {
  return agent.role === "scout" ? SCOUT_VISION_RADIUS : DEFAULT_VISION_RADIUS;
}

export function updateVision(
  agent: Agent,
  grid: Grid,
  allAgents: Map<string, Agent>,
  tick: number,
): void {
  if (!agent.isAlive()) return;

  const radius = getVisionRadius(agent);
  const visibleTiles = grid.getTilesInRadius(agent.position, radius);

  const agentsByPos = new Map<string, Agent[]>();
  for (const [, other] of allAgents) {
    if (other.id === agent.id || !other.isAlive()) continue;
    const key = `${other.position.x},${other.position.y}`;
    const arr = agentsByPos.get(key) ?? [];
    arr.push(other);
    agentsByPos.set(key, arr);
  }

  for (const tile of visibleTiles) {
    const terrain = grid.getTerrain(tile.x, tile.y)!;
    const key = `${tile.x},${tile.y}`;
    const agentsHere = agentsByPos.get(key) ?? [];
    const snapshots: EntitySnapshot[] = agentsHere.map((a) => ({
      id: a.id,
      type: "agent",
      faction: a.faction,
      position: { ...a.position },
    }));

    agent.recordTile(tile.x, tile.y, terrain, snapshots, tick);
  }
}

export function mergeAdjacentMemories(agents: Agent[], grid: Grid): void {
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i];
      const b = agents[j];

      if (!a.isAlive() || !b.isAlive()) continue;
      if (a.faction !== b.faction) continue;
      if (!grid.isAdjacent(a.position, b.position)) continue;

      a.mergeMemory(b.getAllMemory());
      b.mergeMemory(a.getAllMemory());
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All vision tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/vision.ts server/test/simulation/vision.test.ts
git commit -m "feat: implement vision system with MapMemory update and adjacent memory merge"
```

---

## Task 10: Simulation Tick Loop

**Files:**
- Create: `server/src/simulation/tick.ts`
- Create: `server/test/simulation/tick.test.ts`

- [ ] **Step 1: Write failing tick tests**

`server/test/simulation/tick.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { SimulationState, processTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { FOOD_CONSUMPTION_INTERVAL, GATHER_DURATION } from "@town-zero/shared";

function makeWorld(): SimulationState {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  grid.setOwner(5, 5, "v1");
  grid.setOwner(5, 6, "v1");

  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addStructure({ id: "h1", type: "housing", position: { x: 5, y: 5 }, operatorId: null });

  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
  agent.addToInventory("food", 10);
  settlement.populationIds.push("a1");

  return {
    grid,
    agents: new Map([["a1", agent]]),
    settlements: new Map([["v1", settlement]]),
    tick: 0,
    nextMerchantId: 0,
  };
}

describe("processTick", () => {
  it("increments tick counter", () => {
    const world = makeWorld();
    processTick(world);
    expect(world.tick).toBe(1);
  });

  it("executes agent move command from plan", () => {
    const world = makeWorld();
    world.agents.get("a1")!.setPlan([{ type: "move", target: { x: 6, y: 5 } }]);
    processTick(world);
    expect(world.agents.get("a1")!.position).toEqual({ x: 6, y: 5 });
  });

  it("starts gathering when gather command issued", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 3 };
    agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);
    processTick(world);
    expect(agent.state).toBe("gathering");
  });

  it("completes gathering after enough ticks", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.position = { x: 3, y: 3 };
    agent.setPlan([{ type: "gather", resourceTile: { x: 3, y: 3 } }]);

    for (let i = 0; i < GATHER_DURATION + 1; i++) {
      processTick(world);
    }
    expect(agent.inventory.food).toBe(11); // 10 initial + 1 gathered
    expect(agent.state).toBe("idle");
  });

  it("processes food consumption and starvation", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.inventory.food = 0; // starving

    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL; i++) {
      processTick(world);
    }
    expect(agent.hp).toBeLessThan(100);
  });

  it("removes dead agents from settlements", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.hp = 1;
    agent.inventory.food = 0;

    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL * 20; i++) {
      processTick(world);
      if (!agent.isAlive()) break;
    }
    expect(agent.isAlive()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Tick tests FAIL.

- [ ] **Step 3: Implement `tick.ts`**

`server/src/simulation/tick.ts`:
```typescript
import { GATHER_DURATION, ATTACK_COOLDOWN_TICKS, MERCHANT_SPAWN_INTERVAL, MERCHANT_TRADE_RATE } from "@town-zero/shared";
import { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import { validateCommand, executeCommand } from "./commands.js";
import { processGathering, processProduction, processConsumption } from "./resources.js";
import { processCombat } from "./combat.js";
import { updateVision, mergeAdjacentMemories } from "./vision.js";

export interface SimulationState {
  grid: Grid;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  tick: number;
  nextMerchantId: number;
}

export function spawnMerchant(state: SimulationState): void {
  const id = `merchant-${state.nextMerchantId++}`;
  const merchant = new Agent({
    id,
    position: { x: 0, y: Math.floor(state.grid.height / 2) },
    faction: "merchant",
    role: "merchant",
    controller: "bot",
  });
  merchant.addToInventory("currency", 10);
  state.agents.set(id, merchant);
}

export function processMerchantTick(merchant: Agent, state: SimulationState): void {
  if (merchant.role !== "merchant") return;

  for (const [, settlement] of state.settlements) {
    if (settlement.type === "village" && settlement.isInTerritory(merchant.position)) {
      const tradeAmount = Math.min(merchant.inventory.currency, 3);
      if (tradeAmount > 0 && (settlement.inventory.food > 0 || settlement.inventory.material > 0)) {
        const foodToTake = Math.min(tradeAmount * MERCHANT_TRADE_RATE, settlement.inventory.food);
        if (foodToTake > 0) {
          settlement.removeResource("food", foodToTake);
          merchant.addToInventory("food", foodToTake);
          const currencyPaid = Math.ceil(foodToTake / MERCHANT_TRADE_RATE);
          merchant.removeFromInventory("currency", currencyPaid);
          settlement.addResource("currency", currencyPaid);
        }
      }
      merchant.position = { x: merchant.position.x - 1, y: merchant.position.y };
      return;
    }
  }

  const nextX = merchant.position.x + 1;
  if (state.grid.inBounds(nextX, merchant.position.y)) {
    merchant.position = { x: nextX, y: merchant.position.y };
  } else {
    state.agents.delete(merchant.id);
  }
}

export function processTick(state: SimulationState): void {
  state.tick++;

  const { grid, agents, settlements, tick } = state;

  // Phase 1: Process ongoing actions (gathering, fighting)
  for (const [, agent] of agents) {
    if (!agent.isAlive()) continue;

    if (agent.state === "gathering") {
      processGathering(agent, grid);
      continue;
    }

    if (agent.state === "fighting") {
      continue;
    }

    // Phase 2: If idle, dequeue next command
    if (agent.state === "idle" && agent.plan.length > 0) {
      const cmd = agent.shiftPlan()!;
      const ctx = { grid, agent, agents, settlements };

      if (!validateCommand(cmd, ctx)) {
        continue;
      }

      switch (cmd.type) {
        case "move":
        case "deposit":
        case "take":
        case "trade":
        case "idle":
          executeCommand(cmd, ctx);
          break;
        case "gather":
          agent.state = "gathering";
          agent.currentCommandTicks = 0;
          agent.currentCommandTarget = GATHER_DURATION;
          break;
        case "attack": {
          const target = agents.get(cmd.targetId);
          if (target && target.isAlive()) {
            agent.state = "fighting";
            agent.currentCommandTicks = 0;
            agent.currentCommandTarget = ATTACK_COOLDOWN_TICKS;
            processCombat(agent, target);
          }
          break;
        }
        case "talk":
          break;
      }
    }
  }

  // Phase 3: Production
  for (const [, settlement] of settlements) {
    processProduction(settlement, agents, tick);
  }

  // Phase 4: Consumption
  for (const [, agent] of agents) {
    processConsumption(agent, tick);
  }

  // Phase 5: Merchant spawning and movement
  if (tick % MERCHANT_SPAWN_INTERVAL === 0 && tick > 0) {
    spawnMerchant(state);
  }
  for (const [, agent] of agents) {
    if (agent.role === "merchant") {
      processMerchantTick(agent, state);
    }
  }

  // Phase 6: Vision update
  for (const [, agent] of agents) {
    updateVision(agent, grid, agents, tick);
  }

  // Phase 7: Memory merge for adjacent same-faction agents
  const agentList = Array.from(agents.values()).filter((a) => a.isAlive());
  mergeAdjacentMemories(agentList, grid);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All tick tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/tick.ts server/test/simulation/tick.test.ts
git commit -m "feat: implement simulation tick loop integrating all systems"
```

---

## Task 11: Map Generator

**Files:**
- Create: `server/src/map/generator.ts`
- Create: `server/test/map/generator.test.ts`

- [ ] **Step 1: Write failing generator tests**

`server/test/map/generator.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { generateMap } from "../../src/map/generator.js";
import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";

describe("generateMap", () => {
  it("creates a SimulationState with correct grid size", () => {
    const state = generateMap();
    expect(state.grid.width).toBe(GRID_WIDTH);
    expect(state.grid.height).toBe(GRID_HEIGHT);
  });

  it("places exactly one village settlement", () => {
    const state = generateMap();
    const villages = Array.from(state.settlements.values()).filter((s) => s.type === "village");
    expect(villages).toHaveLength(1);
  });

  it("places exactly one monster den", () => {
    const state = generateMap();
    const dens = Array.from(state.settlements.values()).filter((s) => s.type === "den");
    expect(dens).toHaveLength(1);
  });

  it("creates village agents", () => {
    const state = generateMap();
    const villageAgents = Array.from(state.agents.values()).filter((a) => a.faction.startsWith("village"));
    expect(villageAgents.length).toBeGreaterThan(0);
    expect(villageAgents.length).toBeLessThanOrEqual(10);
  });

  it("creates monster agents", () => {
    const state = generateMap();
    const monsterAgents = Array.from(state.agents.values()).filter((a) => a.faction.startsWith("den"));
    expect(monsterAgents.length).toBeGreaterThan(0);
  });

  it("places resource tiles on the map", () => {
    const state = generateMap();
    let resourceCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (state.grid.getResourceYield(x, y)) resourceCount++;
      }
    }
    expect(resourceCount).toBeGreaterThan(0);
  });

  it("places a road (trade route)", () => {
    const state = generateMap();
    let roadCount = 0;
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        if (state.grid.getTerrain(x, y) === "road") roadCount++;
      }
    }
    expect(roadCount).toBeGreaterThan(0);
  });

  it("village has housing and production structures", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    expect(village.structures.some((s) => s.type === "housing")).toBe(true);
    expect(village.structures.some((s) => s.type === "production")).toBe(true);
  });

  it("gives village starting resources", () => {
    const state = generateMap();
    const village = Array.from(state.settlements.values()).find((s) => s.type === "village")!;
    expect(village.inventory.food).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Generator tests FAIL.

- [ ] **Step 3: Implement `generator.ts`**

`server/src/map/generator.ts`:
```typescript
import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";
import { Grid } from "../simulation/grid.js";
import { Agent } from "../simulation/agent.js";
import { Settlement } from "../simulation/settlement.js";
import type { SimulationState } from "../simulation/tick.js";
import type { Position } from "@town-zero/shared";

function rect(cx: number, cy: number, r: number): Position[] {
  const result: Position[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

export function generateMap(): SimulationState {
  const grid = new Grid(GRID_WIDTH, GRID_HEIGHT);
  const agents = new Map<string, Agent>();
  const settlements = new Map<string, Settlement>();

  const villageCx = 10, villageCy = 20;
  const denCx = 30, denCy = 20;
  const resourceCx = 20, resourceCy = 10;

  // Terrain: forest belt
  for (let x = 18; x <= 22; x++) {
    for (let y = 15; y <= 25; y++) {
      grid.setTerrain(x, y, "forest");
    }
  }

  // Mountain patch
  for (let x = 28; x <= 32; x++) {
    for (let y = 15; y <= 17; y++) {
      grid.setTerrain(x, y, "mountain");
    }
  }

  // Water feature
  for (let x = 15; x <= 17; x++) {
    grid.setTerrain(x, 28, "water");
    grid.setTerrain(x, 29, "water");
  }

  // Trade route
  for (let x = 0; x <= villageCx; x++) {
    grid.setTerrain(x, villageCy, "road");
  }

  // Resource zone
  const resourceTiles = rect(resourceCx, resourceCy, 2);
  for (const pos of resourceTiles) {
    grid.setResourceYield(pos.x, pos.y, "food");
    grid.setTerrain(pos.x, pos.y, "plains");
  }
  for (let x = 18; x <= 20; x++) {
    grid.setResourceYield(x, 18, "material");
  }

  // Village
  const villageTerritory = rect(villageCx, villageCy, 2);
  for (const pos of villageTerritory) {
    grid.setOwner(pos.x, pos.y, "village-1");
  }

  const village = new Settlement({
    id: "village-1",
    faction: "village-1",
    type: "village",
    territory: villageTerritory,
  });
  village.addStructure({ id: "vh1", type: "housing", position: { x: villageCx, y: villageCy }, operatorId: null });
  village.addStructure({ id: "vh2", type: "housing", position: { x: villageCx + 1, y: villageCy }, operatorId: null });
  village.addStructure({ id: "vp1", type: "production", position: { x: villageCx, y: villageCy + 1 }, operatorId: null });
  village.addResource("food", 30);
  village.addResource("material", 10);
  settlements.set("village-1", village);

  const villageRoles = ["farmer", "farmer", "hunter", "scout", "worker"];
  for (let i = 0; i < villageRoles.length; i++) {
    const id = `vnpc-${i}`;
    const agent = new Agent({
      id,
      position: { x: villageCx + (i % 3) - 1, y: villageCy + Math.floor(i / 3) - 1 },
      faction: "village-1",
      role: villageRoles[i],
      controller: "llm",
    });
    agent.addToInventory("food", 5);
    agents.set(id, agent);
    village.populationIds.push(id);
  }

  // Monster den
  const denTerritory = rect(denCx, denCy, 2);
  for (const pos of denTerritory) {
    grid.setOwner(pos.x, pos.y, "den-1");
  }

  const den = new Settlement({
    id: "den-1",
    faction: "den-1",
    type: "den",
    territory: denTerritory,
  });
  den.addStructure({ id: "dh1", type: "housing", position: { x: denCx, y: denCy }, operatorId: null });
  den.addStructure({ id: "dp1", type: "production", position: { x: denCx + 1, y: denCy }, operatorId: null });
  den.addResource("food", 20);
  den.addResource("material", 5);
  settlements.set("den-1", den);

  const monsterRoles = ["beast", "beast", "beast"];
  for (let i = 0; i < monsterRoles.length; i++) {
    const id = `mnpc-${i}`;
    const agent = new Agent({
      id,
      position: { x: denCx + (i % 2), y: denCy + Math.floor(i / 2) },
      faction: "den-1",
      role: monsterRoles[i],
      controller: "llm",
    });
    agent.addToInventory("food", 3);
    agents.set(id, agent);
    den.populationIds.push(id);
  }

  return { grid, agents, settlements, tick: 0, nextMerchantId: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All generator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/map/generator.ts server/test/map/generator.test.ts
git commit -m "feat: implement map generator with village, den, resources, and trade route"
```

---

## Task 12: Colyseus Schemas & GameRoom

**Files:**
- Create: `server/src/schema/TileSchema.ts`, `AgentSchema.ts`, `SettlementSchema.ts`, `StructureSchema.ts`, `WorldState.ts`
- Create: `server/src/rooms/GameRoom.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Implement Colyseus schemas**

`server/src/schema/TileSchema.ts`:
```typescript
import { Schema, type } from "@colyseus/schema";

export class TileSchema extends Schema {
  @type("uint8") x: number = 0;
  @type("uint8") y: number = 0;
  @type("string") terrain: string = "plains";
  @type("string") owner: string = "";
  @type("string") resourceYield: string = "";
}
```

`server/src/schema/StructureSchema.ts`:
```typescript
import { Schema, type } from "@colyseus/schema";

export class StructureSchema extends Schema {
  @type("string") id: string = "";
  @type("string") structureType: string = "housing";
  @type("int16") x: number = 0;
  @type("int16") y: number = 0;
  @type("string") operatorId: string = "";
}
```

`server/src/schema/AgentSchema.ts`:
```typescript
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
```

`server/src/schema/SettlementSchema.ts`:
```typescript
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
```

`server/src/schema/WorldState.ts`:
```typescript
import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { TileSchema } from "./TileSchema.js";
import { AgentSchema } from "./AgentSchema.js";
import { SettlementSchema } from "./SettlementSchema.js";

export class WorldState extends Schema {
  @type("uint32") tick: number = 0;
  @type([TileSchema]) tiles = new ArraySchema<TileSchema>();
  @type({ map: AgentSchema }) agents = new MapSchema<AgentSchema>();
  @type({ map: SettlementSchema }) settlements = new MapSchema<SettlementSchema>();
}
```

- [ ] **Step 2: Implement GameRoom**

`server/src/rooms/GameRoom.ts`:
```typescript
import { Room, Client } from "colyseus";
import { WorldState } from "../schema/WorldState.js";
import { TileSchema } from "../schema/TileSchema.js";
import { AgentSchema } from "../schema/AgentSchema.js";
import { SettlementSchema } from "../schema/SettlementSchema.js";
import { StructureSchema } from "../schema/StructureSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import type { ActionCommand, ResourceType } from "@town-zero/shared";
import { TICK_RATE_MS, GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";
import { Agent } from "../simulation/agent.js";

export class GameRoom extends Room<WorldState> {
  private sim!: SimulationState;
  private playerAgentMap = new Map<string, string>();
  private nextPlayerId = 0;
  autoDispose = false;
  maxClients = 4;

  onCreate(): void {
    this.setState(new WorldState());
    this.sim = generateMap();

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = new TileSchema();
        tile.x = x;
        tile.y = y;
        tile.terrain = this.sim.grid.getTerrain(x, y) ?? "plains";
        tile.owner = this.sim.grid.getOwner(x, y) ?? "";
        tile.resourceYield = this.sim.grid.getResourceYield(x, y) ?? "";
        this.state.tiles.push(tile);
      }
    }

    this.syncAgentsToSchema();
    this.syncSettlementsToSchema();

    this.onMessage("command", (client: Client, cmd: ActionCommand) => {
      const agentId = this.playerAgentMap.get(client.sessionId);
      if (!agentId) return;
      const agent = this.sim.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;
      agent.setPlan([cmd]);
    });

    this.setSimulationInterval(() => this.tick(), TICK_RATE_MS);
  }

  onJoin(client: Client): void {
    const village = Array.from(this.sim.settlements.values()).find((s) => s.type === "village");
    if (!village) return;

    const id = `player-${this.nextPlayerId++}`;
    const spawnPos = village.territory[0];
    const agent = new Agent({
      id,
      position: { ...spawnPos },
      faction: village.faction,
      role: "adventurer",
      controller: "player",
    });
    agent.addToInventory("food", 5);

    this.sim.agents.set(id, agent);
    this.playerAgentMap.set(client.sessionId, id);
    village.populationIds.push(id);

    // Tell the client which agent they control
    client.send("assignAgent", { agentId: id });

    this.syncAgentsToSchema();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const agentId = this.playerAgentMap.get(client.sessionId);
    if (!agentId) return;

    try {
      if (!consented) {
        await this.allowReconnection(client, 60);
        const agent = this.sim.agents.get(agentId);
        if (agent) agent.controller = "player";
        return;
      }
    } catch {
      // Reconnection timed out
    }

    const agent = this.sim.agents.get(agentId);
    if (agent) agent.controller = "bot";
    this.playerAgentMap.delete(client.sessionId);
  }

  private tick(): void {
    processTick(this.sim);
    this.state.tick = this.sim.tick;
    this.syncAgentsToSchema();
    this.syncSettlementsToSchema();
  }

  private syncAgentsToSchema(): void {
    for (const [id, agent] of this.sim.agents) {
      let schema = this.state.agents.get(id);
      if (!schema) {
        schema = new AgentSchema();
        schema.id = id;
        this.state.agents.set(id, schema);
      }
      schema.x = agent.position.x;
      schema.y = agent.position.y;
      schema.faction = agent.faction;
      schema.role = agent.role;
      schema.hp = agent.hp;
      schema.maxHp = agent.maxHp;
      schema.food = agent.inventory.food;
      schema.material = agent.inventory.material;
      schema.currency = agent.inventory.currency;
      schema.state = agent.state;
      schema.controller = agent.controller;
    }

    this.state.agents.forEach((_, key) => {
      if (!this.sim.agents.has(key)) {
        this.state.agents.delete(key);
      }
    });
  }

  private syncSettlementsToSchema(): void {
    for (const [id, settlement] of this.sim.settlements) {
      let schema = this.state.settlements.get(id);
      if (!schema) {
        schema = new SettlementSchema();
        schema.id = id;
        schema.faction = settlement.faction;
        schema.settlementType = settlement.type;

        for (const struct of settlement.structures) {
          const ss = new StructureSchema();
          ss.id = struct.id;
          ss.structureType = struct.type;
          ss.x = struct.position.x;
          ss.y = struct.position.y;
          ss.operatorId = struct.operatorId ?? "";
          schema.structures.push(ss);
        }
        this.state.settlements.set(id, schema);
      }
      schema.food = settlement.inventory.food;
      schema.material = settlement.inventory.material;
      schema.currency = settlement.inventory.currency;
    }
  }
}
```

- [ ] **Step 3: Update server entry point**

`server/src/index.ts`:
```typescript
import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const port = Number(process.env.PORT ?? 2567);
const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

gameServer.listen(port);
console.log(`town-zero server listening on port ${port}`);
```

- [ ] **Step 4: Verify server starts**

Run: `npm run dev --workspace=server`
Expected: Server starts, prints "town-zero server listening on port 2567". Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add server/src/schema/ server/src/rooms/GameRoom.ts server/src/index.ts
git commit -m "feat: implement Colyseus schemas, GameRoom, and server entry point"
```

---

## Task 13: Client Renderer, Input & Fog of War

**Files:**
- Modify: `client/src/main.ts`
- Create: `client/src/renderer.ts`
- Create: `client/src/input.ts`
- Create: `client/src/ui.ts`
- Create: `client/src/fog.ts`
- Create: `client/src/types.ts`

- [ ] **Step 1: Create client-side type definitions**

`client/src/types.ts`:
```typescript
export interface TileState {
  x: number;
  y: number;
  terrain: string;
  owner: string;
  resourceYield: string;
}

export interface AgentState {
  id: string;
  x: number;
  y: number;
  faction: string;
  role: string;
  hp: number;
  maxHp: number;
  food: number;
  material: number;
  currency: number;
  state: string;
  controller: string;
}

export interface SettlementState {
  id: string;
  faction: string;
  settlementType: string;
  food: number;
  material: number;
  currency: number;
}

export interface WorldState {
  tick: number;
  tiles: TileState[];
  agents: { forEach: (fn: (v: AgentState, k: string) => void) => void; get: (k: string) => AgentState | undefined };
  settlements: { forEach: (fn: (v: SettlementState, k: string) => void) => void };
}
```

- [ ] **Step 2: Implement renderer**

`client/src/renderer.ts`:
```typescript
import type { WorldState } from "./types.js";
import type { FogOfWar } from "./fog.js";

const TILE_SIZE = 16;

const TERRAIN_COLORS: Record<string, string> = {
  plains: "#4a7c59",
  forest: "#2d5a27",
  mountain: "#6b6b6b",
  water: "#2266aa",
  road: "#8b7355",
};

const AGENT_COLORS: Record<string, string> = {
  "village-1": "#4488ff",
  "den-1": "#ff4444",
  "merchant": "#ffaa00",
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cameraX = 0;
  private cameraY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  centerOn(x: number, y: number): void {
    this.cameraX = x * TILE_SIZE - this.canvas.width / 2;
    this.cameraY = y * TILE_SIZE - this.canvas.height / 2;
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: Math.floor((screenX + this.cameraX) / TILE_SIZE),
      y: Math.floor((screenY + this.cameraY) / TILE_SIZE),
    };
  }

  render(state: WorldState, playerId: string | null, fog: FogOfWar | null): void {
    const { ctx } = this;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const tiles = state.tiles;
    if (!tiles) return;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const screenX = tile.x * TILE_SIZE - this.cameraX;
      const screenY = tile.y * TILE_SIZE - this.cameraY;

      if (screenX + TILE_SIZE < 0 || screenX > this.canvas.width) continue;
      if (screenY + TILE_SIZE < 0 || screenY > this.canvas.height) continue;

      ctx.fillStyle = TERRAIN_COLORS[tile.terrain] ?? "#333";
      ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);

      if (tile.resourceYield) {
        ctx.fillStyle = tile.resourceYield === "food" ? "#ffcc00" : "#cc8844";
        ctx.fillRect(screenX + 5, screenY + 5, 6, 6);
      }

      if (tile.owner) {
        ctx.fillStyle = tile.owner.startsWith("village") ? "rgba(68,136,255,0.15)" : "rgba(255,68,68,0.15)";
        ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);
      }

      // Fog of war overlay
      if (fog && !fog.isVisible(tile.x, tile.y)) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }

    // Draw agents
    state.agents?.forEach((agent) => {
      if (agent.state === "dead") return;

      // Hide agents outside fog
      if (fog && !fog.isVisible(agent.x, agent.y)) return;

      const screenX = agent.x * TILE_SIZE - this.cameraX;
      const screenY = agent.y * TILE_SIZE - this.cameraY;

      ctx.fillStyle = AGENT_COLORS[agent.faction] ?? "#ffffff";
      if (agent.id === playerId) {
        ctx.fillStyle = "#00ff88";
      }

      const size = agent.controller === "player" ? TILE_SIZE - 2 : TILE_SIZE - 4;
      const offset = (TILE_SIZE - size) / 2;
      ctx.fillRect(screenX + offset, screenY + offset, size - 1, size - 1);

      if (agent.hp < agent.maxHp) {
        const barWidth = TILE_SIZE - 2;
        const hpRatio = agent.hp / agent.maxHp;
        ctx.fillStyle = "#333";
        ctx.fillRect(screenX + 1, screenY - 4, barWidth, 3);
        ctx.fillStyle = hpRatio > 0.5 ? "#0f0" : hpRatio > 0.25 ? "#ff0" : "#f00";
        ctx.fillRect(screenX + 1, screenY - 4, barWidth * hpRatio, 3);
      }
    });
  }
}
```

- [ ] **Step 3: Implement input handler**

`client/src/input.ts`:
```typescript
import type { Renderer } from "./renderer.js";
import type { ActionCommand } from "@town-zero/shared";

export type CommandCallback = (cmd: ActionCommand) => void;

export class InputHandler {
  private onCommand: CommandCallback;
  private playerPos: { x: number; y: number } = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    onCommand: CommandCallback,
  ) {
    this.onCommand = onCommand;
    this.canvas.addEventListener("click", (e) => this.handleClick(e));
  }

  setPlayerPosition(x: number, y: number): void {
    this.playerPos = { x, y };
  }

  private handleClick(e: MouseEvent): void {
    const gridPos = this.renderer.screenToGrid(e.clientX, e.clientY);
    const dx = gridPos.x - this.playerPos.x;
    const dy = gridPos.y - this.playerPos.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 1) {
      this.onCommand({ type: "move", target: gridPos });
    }
  }
}
```

- [ ] **Step 4: Implement HUD**

`client/src/ui.ts`:
```typescript
export class HUD {
  private lines: HTMLDivElement[] = [];
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:fixed;top:10px;left:10px;color:#fff;font:14px monospace;background:rgba(0,0,0,0.7);padding:8px;border-radius:4px;pointer-events:none;";
    document.body.appendChild(this.container);

    for (let i = 0; i < 3; i++) {
      const line = document.createElement("div");
      this.container.appendChild(line);
      this.lines.push(line);
    }
  }

  update(info: { tick: number; food: number; material: number; currency: number; hp: number; maxHp: number }): void {
    this.lines[0].textContent = `Tick: ${info.tick}`;
    this.lines[1].textContent = `HP: ${info.hp}/${info.maxHp}`;
    this.lines[2].textContent = `Food: ${info.food} | Material: ${info.material} | Currency: ${info.currency}`;
  }
}
```

- [ ] **Step 5: Implement fog of war**

`client/src/fog.ts`:
```typescript
const VISION_RADIUS = 5;

export class FogOfWar {
  private visibleSet = new Set<string>();

  update(playerX: number, playerY: number, gridWidth: number, gridHeight: number): void {
    this.visibleSet.clear();
    for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
      for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= VISION_RADIUS) {
          const x = playerX + dx;
          const y = playerY + dy;
          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            this.visibleSet.add(`${x},${y}`);
          }
        }
      }
    }
  }

  isVisible(x: number, y: number): boolean {
    return this.visibleSet.has(`${x},${y}`);
  }
}
```

- [ ] **Step 6: Wire up `main.ts`**

`client/src/main.ts`:
```typescript
import { Client } from "@colyseus/sdk";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { HUD } from "./ui.js";
import { FogOfWar } from "./fog.js";
import type { ActionCommand } from "@town-zero/shared";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const hud = new HUD();
const fog = new FogOfWar();

const serverUrl = `ws://${window.location.hostname}:2567`;
const client = new Client(serverUrl);

let playerId: string | null = null;

async function connect(): Promise<void> {
  const room = await client.joinOrCreate("game");

  room.onMessage("assignAgent", (data: { agentId: string }) => {
    playerId = data.agentId;
  });

  const input = new InputHandler(canvas, renderer, (cmd: ActionCommand) => {
    room.send("command", cmd);
  });

  function frame(): void {
    if (playerId) {
      const playerAgent = room.state.agents.get(playerId);
      if (playerAgent) {
        input.setPlayerPosition(playerAgent.x, playerAgent.y);
        renderer.centerOn(playerAgent.x, playerAgent.y);
        fog.update(playerAgent.x, playerAgent.y, 40, 40);
        hud.update({
          tick: room.state.tick,
          food: playerAgent.food,
          material: playerAgent.material,
          currency: playerAgent.currency,
          hp: playerAgent.hp,
          maxHp: playerAgent.maxHp,
        });
      }
    }

    renderer.render(room.state as any, playerId, fog);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

connect().catch((err) => {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f00";
  ctx.font = "20px monospace";
  ctx.fillText(`Connection failed: ${err.message}`, 20, 40);
});
```

- [ ] **Step 7: Verify client builds**

Run server: `npm run dev --workspace=server`
Run client: `npm run dev --workspace=client`
Expected: Client connects, renders grid with tiles, agents, and fog of war.

- [ ] **Step 8: Commit**

```bash
git add client/
git commit -m "feat: implement Canvas 2D client with renderer, input, HUD, and fog of war"
```

---

## Task 14: LLM Integration

**Files:**
- Create: `server/src/ai/prompt-builder.ts`, `response-parser.ts`, `llm-scheduler.ts`
- Create: `server/test/ai/prompt-builder.test.ts`, `response-parser.test.ts`

- [ ] **Step 1: Write failing prompt-builder tests**

`server/test/ai/prompt-builder.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/ai/prompt-builder.js";
import { Agent } from "../../src/simulation/agent.js";

describe("buildPrompt", () => {
  it("includes agent identity and position", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 });
    expect(prompt).toContain("farmer");
    expect(prompt).toContain("(5, 5)");
  });

  it("includes inventory info", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 3);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 });
    expect(prompt).toContain("food");
    expect(prompt).toContain("3");
  });

  it("includes visible entities from memory", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.recordTile(6, 5, "plains", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 6, y: 5 } }], 100);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 100);
    expect(prompt).toContain("(6, 5)");
    expect(prompt).toContain("monster");
  });

  it("distinguishes current vision from stale memory", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.recordTile(6, 5, "plains", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 6, y: 5 } }], 50);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 100);
    expect(prompt).toContain("remember");
  });

  it("lists available actions", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 });
    expect(prompt).toContain("move");
    expect(prompt).toContain("gather");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Prompt-builder tests FAIL.

- [ ] **Step 3: Implement `prompt-builder.ts`**

`server/src/ai/prompt-builder.ts`:
```typescript
import type { Agent } from "../simulation/agent.js";
import type { ResourceStore } from "@town-zero/shared";

export function buildPrompt(
  agent: Agent,
  settlementInventory: ResourceStore,
  currentTick: number = 0,
): string {
  const lines: string[] = [];

  lines.push(`You are ${agent.id}, a ${agent.role} of faction ${agent.faction}.`);
  lines.push(`Position: (${agent.position.x}, ${agent.position.y}), State: ${agent.state}`);
  lines.push(`HP: ${agent.hp}/${agent.maxHp}`);
  lines.push(`Backpack: food x${agent.inventory.food}, material x${agent.inventory.material}, currency x${agent.inventory.currency}`);
  lines.push(`Settlement inventory: food x${settlementInventory.food}, material x${settlementInventory.material}, currency x${settlementInventory.currency}`);

  const seen: string[] = [];
  const remembered: string[] = [];

  for (const [, mem] of agent.getAllMemory()) {
    if (mem.entities.length === 0) continue;
    const pos = `(${mem.entities[0].position.x}, ${mem.entities[0].position.y})`;
    const desc = mem.entities.map((e) => `${e.type} (${e.faction})`).join(", ");

    if (mem.timestamp === currentTick) {
      seen.push(`- ${pos}: ${desc}`);
    } else {
      const ticksAgo = currentTick - mem.timestamp;
      remembered.push(`- ${ticksAgo} ticks ago at ${pos}: ${desc}`);
    }
  }

  if (seen.length > 0) {
    lines.push("You see:");
    lines.push(...seen);
  }

  if (remembered.length > 0) {
    lines.push("You remember:");
    lines.push(...remembered.slice(0, 5));
  }

  lines.push("");
  lines.push("Available actions: move, gather, deposit, take, attack, trade, idle");
  lines.push('Respond with a JSON array of ActionCommand objects. Example: [{"type":"move","target":{"x":6,"y":5}},{"type":"gather","resourceTile":{"x":6,"y":5}}]');

  return lines.join("\n");
}
```

- [ ] **Step 4: Write failing response-parser tests**

`server/test/ai/response-parser.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { parseResponse } from "../../src/ai/response-parser.js";

describe("parseResponse", () => {
  it("parses valid JSON action array", () => {
    const raw = '[{"type":"move","target":{"x":6,"y":5}},{"type":"idle"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("move");
    expect(result[1].type).toBe("idle");
  });

  it("extracts JSON from markdown code block", () => {
    const raw = '```json\n[{"type":"idle"}]\n```';
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns idle on unparseable input", () => {
    const result = parseResponse("I am confused and cannot decide");
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out invalid command types", () => {
    const raw = '[{"type":"move","target":{"x":1,"y":1}},{"type":"fly","destination":"moon"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("move");
  });
});
```

- [ ] **Step 5: Implement `response-parser.ts`**

`server/src/ai/response-parser.ts`:
```typescript
import type { ActionCommand } from "@town-zero/shared";

const VALID_TYPES = new Set(["move", "gather", "attack", "deposit", "take", "talk", "trade", "idle"]);

export function parseResponse(raw: string): ActionCommand[] {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [{ type: "idle" }];

    const commands = parsed.filter(
      (cmd: any) => cmd && typeof cmd.type === "string" && VALID_TYPES.has(cmd.type),
    ) as ActionCommand[];

    return commands.length > 0 ? commands : [{ type: "idle" }];
  } catch {
    return [{ type: "idle" }];
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All prompt-builder and response-parser tests PASS.

- [ ] **Step 7: Implement `llm-scheduler.ts`**

`server/src/ai/llm-scheduler.ts`:
```typescript
import { LLM_CALL_INTERVAL_MS } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import { buildPrompt } from "./prompt-builder.js";
import { parseResponse } from "./response-parser.js";

export type LLMCallFn = (prompt: string) => Promise<string>;

interface ScheduleEntry {
  agentId: string;
  lastCallTime: number;
}

export class LLMScheduler {
  private schedule: ScheduleEntry[] = [];
  private callFn: LLMCallFn;
  private intervalMs: number;

  constructor(callFn: LLMCallFn, intervalMs: number = LLM_CALL_INTERVAL_MS) {
    this.callFn = callFn;
    this.intervalMs = intervalMs;
  }

  register(agentId: string): void {
    this.schedule.push({ agentId, lastCallTime: 0 });
  }

  unregister(agentId: string): void {
    this.schedule = this.schedule.filter((e) => e.agentId !== agentId);
  }

  async update(
    agents: Map<string, Agent>,
    settlements: Map<string, Settlement>,
    now: number,
    simTick: number,
  ): Promise<void> {
    for (const entry of this.schedule) {
      if (now - entry.lastCallTime < this.intervalMs) continue;

      const agent = agents.get(entry.agentId);
      if (!agent || !agent.isAlive()) continue;
      if (agent.controller !== "llm") continue;
      if (agent.state !== "idle" && agent.plan.length > 0) continue;

      const settlement = Array.from(settlements.values()).find((s) =>
        s.populationIds.includes(agent.id),
      );
      const settlementInv = settlement?.inventory ?? { food: 0, material: 0, currency: 0 };

      const prompt = buildPrompt(agent, settlementInv, simTick);

      try {
        const response = await this.callFn(prompt);
        const commands = parseResponse(response);
        agent.setPlan(commands);
        entry.lastCallTime = now;
      } catch (err) {
        console.error(`LLM call failed for ${entry.agentId}:`, err);
      }
    }
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add server/src/ai/ server/test/ai/
git commit -m "feat: implement LLM prompt builder, response parser, and scheduler"
```

---

## Task 15: Dialogue System

**Files:**
- Create: `server/src/dialogue/dialogue-engine.ts`, `dialogue-gate.ts`, `trees/villager-basic.json`
- Create: `server/test/dialogue/dialogue-engine.test.ts`

- [ ] **Step 1: Write failing dialogue engine tests**

`server/test/dialogue/dialogue-engine.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { DialogueEngine } from "../../src/dialogue/dialogue-engine.js";
import type { DialogueTree } from "@town-zero/shared";

const testTree: DialogueTree = {
  id: "test-tree",
  root: "start",
  nodes: {
    start: { type: "text", speaker: "npc", content: "Hello traveler!", next: "choices" },
    choices: {
      type: "choice",
      options: [
        { label: "Ask for help", next: "request" },
        { label: "Goodbye", next: "end" },
      ],
    },
    request: { type: "request", label: "Scout the north", gateType: "llm", nextYes: "yes", nextNo: "no" },
    yes: { type: "text", speaker: "npc", content: "Sure, I'll go scout.", next: "end" },
    no: { type: "text", speaker: "npc", content: "Sorry, I'm too busy.", next: "end" },
    end: { type: "end" },
  },
};

describe("DialogueEngine", () => {
  it("starts at root node", () => {
    const engine = new DialogueEngine(testTree);
    const node = engine.getCurrentNode();
    expect(node.type).toBe("text");
    if (node.type === "text") {
      expect(node.content).toBe("Hello traveler!");
    }
  });

  it("advances through text nodes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    expect(engine.getCurrentNode().type).toBe("choice");
  });

  it("selects a choice option", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    expect(engine.getCurrentNode().type).toBe("request");
  });

  it("resolves request node with yes", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    engine.resolveRequest(true);
    const node = engine.getCurrentNode();
    if (node.type === "text") {
      expect(node.content).toContain("scout");
    }
  });

  it("resolves request node with no", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(0);
    engine.resolveRequest(false);
    const node = engine.getCurrentNode();
    if (node.type === "text") {
      expect(node.content).toContain("busy");
    }
  });

  it("detects end of dialogue", () => {
    const engine = new DialogueEngine(testTree);
    engine.advance();
    engine.selectOption(1);
    expect(engine.isEnded()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Dialogue tests FAIL.

- [ ] **Step 3: Implement `dialogue-engine.ts`**

`server/src/dialogue/dialogue-engine.ts`:
```typescript
import type { DialogueTree, DialogueNode, DialogueNodeId } from "@town-zero/shared";

export class DialogueEngine {
  private tree: DialogueTree;
  private currentNodeId: DialogueNodeId;
  private locals: Map<string, unknown> = new Map();

  constructor(tree: DialogueTree) {
    this.tree = tree;
    this.currentNodeId = tree.root;
    if (tree.defaultLocals) {
      for (const [k, v] of Object.entries(tree.defaultLocals)) {
        this.locals.set(k, v);
      }
    }
  }

  getCurrentNode(): DialogueNode {
    return this.tree.nodes[this.currentNodeId];
  }

  getCurrentNodeId(): DialogueNodeId {
    return this.currentNodeId;
  }

  isEnded(): boolean {
    return this.getCurrentNode().type === "end";
  }

  advance(): void {
    const node = this.getCurrentNode();
    if (node.type === "text") {
      this.currentNodeId = node.next;
    } else if (node.type === "action") {
      this.currentNodeId = node.next;
    }
  }

  selectOption(index: number): void {
    const node = this.getCurrentNode();
    if (node.type !== "choice") return;
    const option = node.options[index];
    if (option) {
      this.currentNodeId = option.next;
    }
  }

  resolveRequest(accepted: boolean): void {
    const node = this.getCurrentNode();
    if (node.type !== "request") return;
    this.currentNodeId = accepted ? node.nextYes : node.nextNo;
  }

  getLocal(key: string): unknown {
    return this.locals.get(key);
  }

  setLocal(key: string, value: unknown): void {
    this.locals.set(key, value);
  }
}
```

- [ ] **Step 4: Implement `dialogue-gate.ts`**

`server/src/dialogue/dialogue-gate.ts`:
```typescript
import type { Agent } from "../simulation/agent.js";
import { buildPrompt } from "../ai/prompt-builder.js";
import type { LLMCallFn } from "../ai/llm-scheduler.js";

export async function evaluateDialogueGate(
  npc: Agent,
  requestLabel: string,
  playerName: string,
  callFn: LLMCallFn,
  settlementInventory: { food: number; material: number; currency: number },
): Promise<boolean> {
  const basePrompt = buildPrompt(npc, settlementInventory);
  const gatePrompt = [
    basePrompt,
    "",
    `Player ${playerName} requests: "${requestLabel}"`,
    "Given your current situation, will you agree? Reply y or n.",
  ].join("\n");

  try {
    const response = await callFn(gatePrompt);
    const answer = response.trim().toLowerCase();
    return answer.startsWith("y");
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Create example dialogue tree**

`server/src/dialogue/trees/villager-basic.json`:
```json
{
  "id": "villager-basic",
  "root": "greeting",
  "nodes": {
    "greeting": { "type": "text", "speaker": "npc", "content": "Hello, what can I do for you?", "next": "main-choices" },
    "main-choices": { "type": "choice", "options": [
      { "label": "How is the village doing?", "next": "village-status" },
      { "label": "Can you scout the north?", "next": "scout-request" },
      { "label": "Can you gather food?", "next": "gather-request" },
      { "label": "Never mind.", "next": "farewell" }
    ]},
    "village-status": { "type": "text", "speaker": "npc", "content": "We're managing, but food supplies are getting low.", "next": "main-choices" },
    "scout-request": { "type": "request", "label": "Scout the northern area", "gateType": "llm", "nextYes": "scout-yes", "nextNo": "scout-no" },
    "scout-yes": { "type": "text", "speaker": "npc", "content": "Alright, I'll head north and report back.", "next": "farewell" },
    "scout-no": { "type": "text", "speaker": "npc", "content": "I can't right now, I have other duties.", "next": "main-choices" },
    "gather-request": { "type": "request", "label": "Go gather food for the village", "gateType": "llm", "nextYes": "gather-yes", "nextNo": "gather-no" },
    "gather-yes": { "type": "text", "speaker": "npc", "content": "Sure, I'll head to the fields.", "next": "farewell" },
    "gather-no": { "type": "text", "speaker": "npc", "content": "I need to rest first, maybe later.", "next": "main-choices" },
    "farewell": { "type": "text", "speaker": "npc", "content": "Take care out there.", "next": "end" },
    "end": { "type": "end" }
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All dialogue tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/dialogue/ server/test/dialogue/
git commit -m "feat: implement dialogue tree engine, LLM gate, and example tree data"
```

---

## Task 16: Bot Controller

**Files:**
- Create: `server/src/ai/bot-controller.ts`
- Create: `server/test/ai/bot-controller.test.ts`

- [ ] **Step 1: Write failing bot controller tests**

`server/test/ai/bot-controller.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { decideBotAction } from "../../src/ai/bot-controller.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";

describe("decideBotAction", () => {
  it("returns move toward settlement when food is low", () => {
    const agent = new Agent({ id: "a1", position: { x: 7, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("move");
    if (cmd.type === "move") {
      expect(cmd.target.x).toBe(6);
    }
  });

  it("returns idle when already in settlement territory with food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    agent.addToInventory("food", 5);
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("idle");
  });

  it("returns take when in settlement with no personal food but settlement has food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    settlement.addResource("food", 10);
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("take");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace=server`
Expected: Bot tests FAIL.

- [ ] **Step 3: Implement `bot-controller.ts`**

`server/src/ai/bot-controller.ts`:
```typescript
import type { ActionCommand, Position } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";

function moveToward(from: Position, to: Position): Position {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx !== 0) return { x: from.x + dx, y: from.y };
  if (dy !== 0) return { x: from.x, y: from.y + dy };
  return from;
}

export function decideBotAction(agent: Agent, settlement: Settlement): ActionCommand {
  const inTerritory = settlement.isInTerritory(agent.position);

  if (agent.inventory.food <= 0) {
    if (inTerritory && settlement.inventory.food > 0) {
      return { type: "take", settlementId: settlement.id, resource: "food", amount: Math.min(3, settlement.inventory.food) };
    }
    const target = moveToward(agent.position, settlement.territory[0]);
    if (target.x !== agent.position.x || target.y !== agent.position.y) {
      return { type: "move", target };
    }
  }

  if (inTerritory && agent.inventory.food > 0) {
    return { type: "idle" };
  }

  const target = moveToward(agent.position, settlement.territory[0]);
  if (target.x !== agent.position.x || target.y !== agent.position.y) {
    return { type: "move", target };
  }

  return { type: "idle" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: All bot tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/bot-controller.ts server/test/ai/bot-controller.test.ts
git commit -m "feat: implement bot controller with survival-oriented decision logic"
```

---

## Task 17: Merchant Tests

**Files:**
- Create: `server/test/simulation/merchant.test.ts`

- [ ] **Step 1: Write merchant tests**

`server/test/simulation/merchant.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { spawnMerchant, processMerchantTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function makeWorldWithRoad(): SimulationState {
  const grid = new Grid(10, 10);
  for (let x = 0; x <= 5; x++) {
    grid.setTerrain(x, 5, "road");
  }

  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
  settlement.addResource("food", 10);
  settlement.addResource("material", 10);

  return { grid, agents: new Map(), settlements: new Map([["v1", settlement]]), tick: 0, nextMerchantId: 0 };
}

describe("spawnMerchant", () => {
  it("creates a merchant agent at map edge", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchants = Array.from(state.agents.values()).filter((a) => a.role === "merchant");
    expect(merchants).toHaveLength(1);
    expect(merchants[0].position.x).toBe(0);
    expect(merchants[0].inventory.currency).toBeGreaterThan(0);
  });
});

describe("processMerchantTick", () => {
  it("merchant moves along road toward village", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchant = Array.from(state.agents.values()).find((a) => a.role === "merchant")!;
    const startX = merchant.position.x;
    processMerchantTick(merchant, state);
    expect(merchant.position.x).toBeGreaterThan(startX);
  });

  it("merchant trades at village then leaves", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchant = Array.from(state.agents.values()).find((a) => a.role === "merchant")!;
    merchant.position = { x: 5, y: 5 };
    processMerchantTick(merchant, state);
    const village = state.settlements.get("v1")!;
    expect(village.inventory.currency).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test --workspace=server`
Expected: Merchant tests PASS (implementation already exists in tick.ts).

- [ ] **Step 3: Commit**

```bash
git add server/test/simulation/merchant.test.ts
git commit -m "test: add merchant system tests"
```

---

## Task 18: Integration Test

**Files:**
- Create: `server/test/integration.test.ts`

- [ ] **Step 1: Write integration test**

`server/test/integration.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { generateMap } from "../src/map/generator.js";
import { processTick } from "../src/simulation/tick.js";

describe("Full simulation integration", () => {
  it("runs 100 ticks without crashing", () => {
    const state = generateMap();
    for (let i = 0; i < 100; i++) {
      processTick(state);
    }
    expect(state.tick).toBe(100);
  });

  it("village has agents alive after 50 ticks with food", () => {
    const state = generateMap();
    for (let i = 0; i < 50; i++) {
      processTick(state);
    }
    const villageAgents = Array.from(state.agents.values()).filter(
      (a) => a.faction === "village-1" && a.isAlive(),
    );
    expect(villageAgents.length).toBeGreaterThan(0);
  });

  it("agents build up map memory over time", () => {
    const state = generateMap();
    for (let i = 0; i < 10; i++) {
      processTick(state);
    }
    const agent = Array.from(state.agents.values())[0];
    expect(agent.getAllMemory().size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npm test --workspace=server`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/integration.test.ts
git commit -m "test: add full simulation integration tests"
```

---

## Task 19: Final Wiring & Smoke Test

- [ ] **Step 1: Wire bot controller into tick loop**

In `server/src/simulation/tick.ts`, add bot controller processing. Import `decideBotAction` from `../ai/bot-controller.js` and after Phase 2, for each idle bot agent, call `decideBotAction` and set the resulting plan:

```typescript
// After Phase 2 (command dequeue), before Phase 3:
for (const [, agent] of agents) {
  if (!agent.isAlive() || agent.controller !== "bot") continue;
  if (agent.state !== "idle" || agent.plan.length > 0) continue;
  if (agent.role === "merchant") continue; // merchants have their own logic

  const settlement = Array.from(settlements.values()).find((s) =>
    s.populationIds.includes(agent.id),
  );
  if (settlement) {
    const cmd = decideBotAction(agent, settlement);
    agent.setPlan([cmd]);
  }
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm test --workspace=server`
Expected: All tests PASS.

- [ ] **Step 3: Smoke test the complete game**

Run server: `npm run dev --workspace=server`
Run client: `npm run dev --workspace=client`

Verify:
- Server starts without errors
- Client connects and renders grid
- Player agent appears (green block)
- NPC agents visible (blue for village, red for den)
- Clicking adjacent tiles moves player
- HUD shows tick counter incrementing
- Fog of war dims distant tiles
- Agents outside vision are hidden
- Game continues running when player is idle

- [ ] **Step 4: Commit**

```bash
git add --all
git commit -m "feat: wire up bot controller and complete MVP game loop"
```
