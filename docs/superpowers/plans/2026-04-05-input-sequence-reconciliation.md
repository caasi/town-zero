# Input Sequence Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the key-state movement model with Gambetta-style per-tick input sequencing and server reconciliation to eliminate movement snap-back.

**Architecture:** Client sends individually sequenced `move` messages each tick (125ms) while a key is held. Server consumes one per tick from a per-agent `moveQueue`, advancing `lastProcessedInput`. Client reconciles by replaying unacknowledged inputs on top of the authoritative server state.

**Tech Stack:** TypeScript, Colyseus 0.17.x + @colyseus/schema 4.x, Vitest

**Spec:** `docs/superpowers/specs/2026-04-05-input-sequence-reconciliation-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `shared/src/constants.ts` | Add `MOVE_QUEUE_CAP`, `PENDING_INPUT_CAP`, `DIRECTION_DELTA` |
| Modify | `shared/src/types.ts` | Add `PendingInput` type |
| Modify | `server/src/simulation/agent.ts` | Add `lastProcessedInput`, `moveQueue` fields |
| Modify | `server/src/rooms/schemas/AgentSchema.ts` | Add `lastProcessedInput` field |
| Modify | `server/src/rooms/sync.ts:11-26` | Sync `lastProcessedInput` |
| Modify | `server/src/rooms/GameRoom.ts:67-85` | Replace `move:start`/`move:stop` handlers |
| Modify | `server/src/dialogue/session-manager.ts:155` | Replace `heldDirection = null` with `moveQueue = []` |
| Modify | `server/src/simulation/tick.ts:81-93` | Replace Phase 1.5 with moveQueue consumer |
| Modify | `client/src/network.ts:85-91` | Replace `sendMoveStart`/`sendMoveStop` with `sendMove`/`sendMoveStop(seq)` |
| Modify | `client/src/display.ts` | Replace desync threshold with reconciliation replay |
| Modify | `client/src/input.ts:72-351` | Per-tick move sends + pending buffer |
| Modify | `client/src/main.ts:234-235` | Update wiring |
| Test | `server/test/simulation/tick.test.ts` | moveQueue processing tests |
| Test | `client/test/display.test.ts` | Reconciliation replay tests |

---

### Task 1: Add shared constants and types

**Files:**
- Modify: `shared/src/constants.ts:46`
- Modify: `shared/src/types.ts:38`

- [ ] **Step 1: Add constants to `shared/src/constants.ts`**

After the LLM section (line 45), add:

```typescript
// --- Movement reconciliation ---
export const MOVE_QUEUE_CAP = 3;       // server-side per-agent input buffer depth
export const PENDING_INPUT_CAP = 20;   // client-side pending input buffer safety valve

export const DIRECTION_DELTA: Record<string, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
};
```

- [ ] **Step 2: Add `PendingInput` type to `shared/src/types.ts`**

After the `Facing` type (line 38), add:

```typescript
export interface PendingInput {
  seq: number;
  direction: Facing;
}
```

- [ ] **Step 3: Verify shared package builds**

Run: `pnpm run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add shared/src/constants.ts shared/src/types.ts
git commit -m "feat: add movement reconciliation constants and PendingInput type"
```

---

### Task 2: Add `moveQueue` and `lastProcessedInput` to server Agent

**Files:**
- Modify: `server/src/simulation/agent.ts:51-52`
- Test: `server/test/simulation/agent.test.ts`

- [ ] **Step 1: Write failing test — agent has moveQueue and lastProcessedInput**

Add to `server/test/simulation/agent.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";

describe("Agent moveQueue", () => {
  it("initialises with empty moveQueue and lastProcessedInput 0", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "player" });
    expect(agent.moveQueue).toEqual([]);
    expect(agent.lastProcessedInput).toBe(0);
  });

  it("caps moveQueue at MOVE_QUEUE_CAP, dropping oldest", () => {
    const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "player" });
    agent.enqueueMoveInput({ seq: 1, direction: "north" });
    agent.enqueueMoveInput({ seq: 2, direction: "east" });
    agent.enqueueMoveInput({ seq: 3, direction: "south" });
    agent.enqueueMoveInput({ seq: 4, direction: "west" }); // overflow
    expect(agent.moveQueue).toHaveLength(3);
    expect(agent.moveQueue[0].seq).toBe(2); // oldest (seq=1) dropped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- server/test/simulation/agent.test.ts`
Expected: FAIL — `moveQueue` and `enqueueMoveInput` not defined

- [ ] **Step 3: Implement — add fields and method to Agent**

In `server/src/simulation/agent.ts`, replace lines 51-52 (`heldDirection` comment and field) with:

```typescript
  // Per-tick movement input queue (Gambetta reconciliation model)
  moveQueue: PendingInput[] = [];
  lastProcessedInput: number = 0;
```

Add import at top of file:

```typescript
import type { PendingInput } from "@town-zero/shared";
import { MOVE_QUEUE_CAP } from "@town-zero/shared";
```

Add method after `clearPlan()` (after line 106):

```typescript
  enqueueMoveInput(input: PendingInput): void {
    this.moveQueue.push(input);
    while (this.moveQueue.length > MOVE_QUEUE_CAP) {
      this.moveQueue.shift();
    }
  }
```

Remove the old `heldDirection` field entirely (line 52: `heldDirection: Facing | null = null;`).

- [ ] **Step 4: Fix compilation — update all `heldDirection` references**

`heldDirection` is referenced in:
- `server/src/simulation/tick.ts:82-83` (Phase 1.5) — will be replaced in Task 5
- `server/src/rooms/GameRoom.ts:76,84` (message handlers) — will be replaced in Task 4
- `server/src/dialogue/session-manager.ts:155` (`player.heldDirection = null`) — replace now with `player.moveQueue = [];`

For now, add a temporary `heldDirection` getter that returns `null` to avoid breaking the build until Tasks 4-5 replace the remaining call sites:

```typescript
  /** @deprecated — remove after moveQueue migration */
  get heldDirection(): Facing | null { return null; }
  set heldDirection(_: Facing | null) { /* no-op */ }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test -- server/test/simulation/agent.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/agent.test.ts
git commit -m "feat: add moveQueue and lastProcessedInput to Agent"
```

---

### Task 3: Add `lastProcessedInput` to AgentSchema and sync

**Files:**
- Modify: `server/src/rooms/schemas/AgentSchema.ts:3-16`
- Modify: `server/src/rooms/sync.ts:11-26`
- Test: `server/test/rooms/sync.test.ts`

- [ ] **Step 1: Write failing test — syncAgent copies lastProcessedInput**

Add to `server/test/rooms/sync.test.ts` (find the existing `syncAgent` describe block):

```typescript
it("syncs lastProcessedInput", () => {
  const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "player" });
  agent.lastProcessedInput = 42;
  const schema = new AgentSchema();
  syncAgent(agent, schema);
  expect(schema.lastProcessedInput).toBe(42);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run test -- server/test/rooms/sync.test.ts`
Expected: FAIL — `lastProcessedInput` not on schema

- [ ] **Step 3: Add field to AgentSchema**

In `server/src/rooms/schemas/AgentSchema.ts`, add after `currentTargetId` (line 14):

```typescript
  lastProcessedInput: "number",
```

- [ ] **Step 4: Add sync line to `syncAgent`**

In `server/src/rooms/sync.ts`, add after line 22 (`agentSchema.currentTargetId = ...`):

```typescript
  agentSchema.lastProcessedInput = agent.lastProcessedInput;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm run test -- server/test/rooms/sync.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/schemas/AgentSchema.ts server/src/rooms/sync.ts server/test/rooms/sync.test.ts
git commit -m "feat: sync lastProcessedInput through AgentSchema"
```

---

### Task 4: Replace server message handlers (`move:start`/`move:stop` → `move`/`move:stop`)

**Files:**
- Modify: `server/src/rooms/GameRoom.ts:67-85`

- [ ] **Step 1: Replace message handlers in `GameRoom.onCreate`**

Replace lines 66-85 (the `move:start` and `move:stop` handlers) with:

```typescript
    // Per-tick movement: client sends { direction, seq } each 125ms
    this.onMessage("move", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;
      if (agent.state === "talking") return;
      if (typeof data !== "object" || data === null) return;
      const dir = (data as any).direction;
      const seq = (data as any).seq;
      if (!VALID_DIRECTIONS.has(dir)) return;
      if (typeof seq !== "number") return;
      agent.enqueueMoveInput({ seq, direction: dir as Facing });
    });

    this.onMessage("move:stop", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent) return;
      agent.moveQueue = [];
      const seq = typeof data === "object" && data !== null ? (data as any).seq : undefined;
      if (typeof seq === "number") {
        agent.lastProcessedInput = seq;
      }
    });
```

Add `PendingInput` to the import from `@town-zero/shared` if not already present (the `Facing` import should already exist).

- [ ] **Step 2: Reset on join — add to `onJoin`**

In `onJoin` (around line 174, after `agent.addToInventory("food", 5);`), add:

```typescript
    agent.lastProcessedInput = 0;
    agent.moveQueue = [];
```

- [ ] **Step 3: Run full server tests**

Run: `pnpm run test`
Expected: PASS (existing tests don't use `move:start`/`move:stop` directly)

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/GameRoom.ts
git commit -m "feat: replace move:start/move:stop with per-tick move handler"
```

---

### Task 5: Replace Phase 1.5 with moveQueue consumer

**Files:**
- Modify: `server/src/simulation/tick.ts:49-93`
- Test: `server/test/simulation/tick.test.ts`

- [ ] **Step 1: Write failing tests for moveQueue-based movement**

Add to `server/test/simulation/tick.test.ts`:

```typescript
describe("Phase 1.5: moveQueue", () => {
  it("consumes one move input per tick and advances lastProcessedInput", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.facing = "south";
    agent.enqueueMoveInput({ seq: 1, direction: "south" });
    processTick(world);
    expect(agent.position).toEqual({ x: 5, y: 6 });
    expect(agent.lastProcessedInput).toBe(1);
  });

  it("advances lastProcessedInput even when move is rejected (wall)", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    world.grid.setTerrain(5, 4, "water");
    agent.facing = "north";
    agent.enqueueMoveInput({ seq: 1, direction: "north" });
    processTick(world);
    expect(agent.position).toEqual({ x: 5, y: 5 }); // didn't move
    expect(agent.lastProcessedInput).toBe(1);         // but seq advanced
  });

  it("processes turn-before-move and advances lastProcessedInput", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.facing = "south";
    agent.enqueueMoveInput({ seq: 1, direction: "east" });
    processTick(world);
    expect(agent.facing).toBe("east");
    expect(agent.position).toEqual({ x: 5, y: 5 }); // turned only
    expect(agent.lastProcessedInput).toBe(1);
  });

  it("does not consume moveQueue when agent is not idle", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.state = "gathering";
    agent.enqueueMoveInput({ seq: 1, direction: "south" });
    processTick(world);
    expect(agent.moveQueue).toHaveLength(1); // not consumed
    expect(agent.lastProcessedInput).toBe(0);
  });

  it("consumes one per tick, leaving rest in queue", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.facing = "south";
    agent.enqueueMoveInput({ seq: 1, direction: "south" });
    agent.enqueueMoveInput({ seq: 2, direction: "south" });
    processTick(world);
    expect(agent.moveQueue).toHaveLength(1);
    expect(agent.moveQueue[0].seq).toBe(2);
    expect(agent.lastProcessedInput).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- server/test/simulation/tick.test.ts`
Expected: FAIL — moveQueue not consumed in Phase 1.5

- [ ] **Step 3: Replace Phase 1.5 in tick.ts**

In `server/src/simulation/tick.ts`:

Remove the local `DIRECTION_DELTA` constant (lines 49-52) and import from shared:

```typescript
import { DIRECTION_DELTA } from "@town-zero/shared";
```

Replace Phase 1.5 (lines 81-93) with:

```typescript
    // Phase 1.5: Consume one move input from moveQueue (per-tick input model)
    if (agent.state === "idle" && agent.moveQueue.length > 0) {
      const input = agent.moveQueue.shift()!;
      const delta = DIRECTION_DELTA[input.direction];
      if (delta) {
        const target = { x: agent.position.x + delta.dx, y: agent.position.y + delta.dy };
        const moveCmd = { type: "move" as const, target };
        const ctx = { grid, agent, agents, settlements };
        if (validateCommand(moveCmd, ctx)) {
          executeCommand(moveCmd, ctx);
        }
      }
      agent.lastProcessedInput = input.seq;
      continue;
    }
```

- [ ] **Step 4: Remove deprecated `heldDirection` shim from Agent**

In `server/src/simulation/agent.ts`, remove the temporary getter/setter added in Task 2 Step 4.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/simulation/tick.ts server/test/simulation/tick.test.ts server/src/simulation/agent.ts
git commit -m "feat: replace heldDirection Phase 1.5 with moveQueue consumer"
```

---

### Task 6: Update client NetworkClient

**Files:**
- Modify: `client/src/network.ts:85-91`

- [ ] **Step 1: Replace `sendMoveStart`/`sendMoveStop` methods**

In `client/src/network.ts`, replace lines 85-91:

```typescript
  sendMove(direction: string, seq: number): void {
    this.room?.send("move", { direction, seq });
  }

  sendMoveStop(seq: number): void {
    this.room?.send("move:stop", { seq });
  }
```

- [ ] **Step 2: Commit**

```bash
git add client/src/network.ts
git commit -m "feat: replace sendMoveStart/sendMoveStop with sendMove/sendMoveStop(seq)"
```

---

### Task 7: Rewrite DisplayState with reconciliation replay

**Files:**
- Modify: `client/src/display.ts`
- Test: `client/test/display.test.ts`

- [ ] **Step 1: Write failing tests for reconciliation**

Replace the `syncFromServer` tests in `client/test/display.test.ts` and add new reconciliation tests. Keep the existing `predictMove` tests (lines 14-104 approximately). Add:

```typescript
describe("reconcileFromServer", () => {
  it("with no pending inputs, display equals server position", () => {
    const ds = new DisplayState();
    ds.setLocalPlayer("p1");
    const tiles = makeTiles({ "0,0": { terrain: "plains" } });
    ds.setTileSource(tiles);

    const pending: PendingInput[] = [];
    const remaining = ds.reconcileFromServer("p1",
      { x: 3, y: 4, facing: "south", lastProcessedInput: 0, state: "idle" },
      pending,
    );
    expect(remaining).toEqual([]);
    expect(ds.get("p1")!.displayX).toBe(3);
    expect(ds.get("p1")!.displayY).toBe(4);
  });

  it("prunes acknowledged inputs and replays remaining", () => {
    const ds = new DisplayState();
    ds.setLocalPlayer("p1");
    const tiles = makeTiles({
      "3,4": { terrain: "plains" },
      "3,5": { terrain: "plains" },
      "3,6": { terrain: "plains" },
    });
    ds.setTileSource(tiles);

    const pending: PendingInput[] = [
      { seq: 1, direction: "south" },
      { seq: 2, direction: "south" },
      { seq: 3, direction: "south" },
    ];
    const remaining = ds.reconcileFromServer("p1",
      { x: 3, y: 4, facing: "south", lastProcessedInput: 1, state: "idle" },
      pending,
    );
    // seq 1 pruned, seq 2+3 replayed from (3,4) facing south
    expect(remaining).toHaveLength(2);
    expect(remaining[0].seq).toBe(2);
    expect(ds.get("p1")!.displayX).toBe(3);
    expect(ds.get("p1")!.displayY).toBe(6); // moved 2 tiles south
  });

  it("replays turn-before-move correctly", () => {
    const ds = new DisplayState();
    ds.setLocalPlayer("p1");
    const tiles = makeTiles({
      "0,0": { terrain: "plains" },
      "1,0": { terrain: "plains" },
    });
    ds.setTileSource(tiles);

    const pending: PendingInput[] = [
      { seq: 1, direction: "east" }, // turn only (was facing south)
      { seq: 2, direction: "east" }, // actual move
    ];
    const remaining = ds.reconcileFromServer("p1",
      { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "idle" },
      pending,
    );
    expect(remaining).toHaveLength(2);
    expect(ds.get("p1")!.displayX).toBe(1); // turned then moved
    expect(ds.get("p1")!.facing).toBe("east");
  });

  it("server rejection undoes predicted move", () => {
    const ds = new DisplayState();
    ds.setLocalPlayer("p1");
    const tiles = makeTiles({
      "0,0": { terrain: "plains" },
      "1,0": { terrain: "water" }, // impassable
    });
    ds.setTileSource(tiles);

    const pending: PendingInput[] = [
      { seq: 1, direction: "east" }, // turn
      { seq: 2, direction: "east" }, // would be rejected by replay (water)
    ];
    // Server processed seq 1 (turn only), position didn't change
    const remaining = ds.reconcileFromServer("p1",
      { x: 0, y: 0, facing: "east", lastProcessedInput: 1, state: "idle" },
      pending,
    );
    expect(remaining).toHaveLength(1);
    expect(ds.get("p1")!.displayX).toBe(0); // didn't move (water)
    expect(ds.get("p1")!.facing).toBe("east");
  });

  it("clears pending when agent state is not idle", () => {
    const ds = new DisplayState();
    ds.setLocalPlayer("p1");
    const tiles = makeTiles({});
    ds.setTileSource(tiles);

    const pending: PendingInput[] = [
      { seq: 1, direction: "south" },
      { seq: 2, direction: "south" },
    ];
    const remaining = ds.reconcileFromServer("p1",
      { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "fighting" },
      pending,
    );
    expect(remaining).toEqual([]);
    expect(ds.get("p1")!.displayX).toBe(0);
  });
});
```

Add the import at the top of the test file:

```typescript
import type { PendingInput } from "@town-zero/shared";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- client/test/display.test.ts`
Expected: FAIL — `reconcileFromServer`, `setTileSource` not defined

- [ ] **Step 3: Rewrite `display.ts`**

Replace the entire content of `client/src/display.ts` with:

```typescript
// client/src/display.ts
import { TERRAIN_MOVE_COST, DIRECTION_DELTA } from "@town-zero/shared";
import type { TerrainType, PendingInput } from "@town-zero/shared";
import { TILE_SIZE } from "./constants.js";

const BASE_LERP_FACTOR = 0.5;
const BASE_FRAME_MS = 16.67; // 60fps baseline

export interface AgentDisplay {
  displayX: number;
  displayY: number;
  renderX: number;
  renderY: number;
  facing: string;
}

type TileSource = { get(key: string): { terrain: string } | undefined };

interface ServerAgent {
  x: number;
  y: number;
  facing: string;
  lastProcessedInput: number;
  state: string;
}

export class DisplayState {
  private displays = new Map<string, AgentDisplay>();
  private localPlayerId: string | null = null;
  private tileSource: TileSource | null = null;

  setLocalPlayer(id: string | null): void {
    this.localPlayerId = id;
  }

  setTileSource(tiles: TileSource): void {
    this.tileSource = tiles;
  }

  getLocalPlayerPosition(): { x: number; y: number } | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return { x: display.displayX, y: display.displayY };
  }

  getLocalPlayerFacing(): string | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return display.facing;
  }

  /**
   * Attempt client-side predicted move for the local player.
   * Returns true if prediction was applied, false if invalid.
   */
  predictMove(
    targetX: number,
    targetY: number,
    agentState: string,
    tiles: TileSource,
  ): boolean {
    if (!this.localPlayerId) return false;
    if (agentState !== "idle") return false;

    const existing = this.displays.get(this.localPlayerId);
    const originX = existing?.displayX ?? targetX;
    const originY = existing?.displayY ?? targetY;
    const display = this.getOrCreate(this.localPlayerId, originX, originY);

    const dx = targetX - originX;
    const dy = targetY - originY;
    let intendedFacing = display.facing;
    if (dx > 0) intendedFacing = "east";
    else if (dx < 0) intendedFacing = "west";
    else if (dy > 0) intendedFacing = "south";
    else if (dy < 0) intendedFacing = "north";

    // Turn-before-move: if facing differs, only turn (no position change)
    if (intendedFacing !== display.facing) {
      display.facing = intendedFacing;
      return true;
    }

    const tile = tiles.get(`${targetX},${targetY}`);
    if (tile) {
      const terrain = tile.terrain as TerrainType;
      if (terrain in TERRAIN_MOVE_COST && TERRAIN_MOVE_COST[terrain] === Infinity) {
        return false;
      }
    }

    display.displayX = targetX;
    display.displayY = targetY;
    return true;
  }

  /**
   * Gambetta reconciliation for the local player.
   * 1. Accept server state as authoritative baseline
   * 2. Prune acknowledged inputs (seq <= lastProcessedInput)
   * 3. Replay remaining inputs from baseline
   * Returns the pruned pending input array.
   */
  reconcileFromServer(
    id: string,
    server: ServerAgent,
    pendingInputs: PendingInput[],
  ): PendingInput[] {
    const display = this.getOrCreate(id, server.x, server.y, server.facing);

    // Non-idle: clear all predictions, snap to server
    if (server.state !== "idle") {
      display.displayX = server.x;
      display.displayY = server.y;
      display.facing = server.facing;
      return [];
    }

    // Prune acknowledged inputs
    const remaining = pendingInputs.filter((p) => p.seq > server.lastProcessedInput);

    // Reset to server baseline before replay
    display.displayX = server.x;
    display.displayY = server.y;
    display.facing = server.facing;

    // Replay unacknowledged inputs
    const tiles = this.tileSource;
    if (tiles) {
      for (const input of remaining) {
        const delta = DIRECTION_DELTA[input.direction];
        if (!delta) continue;
        const targetX = display.displayX + delta.dx;
        const targetY = display.displayY + delta.dy;
        // Inline turn-before-move + terrain check (same logic as predictMove)
        this.replayOne(display, targetX, targetY, input.direction, tiles);
      }
    }

    return remaining;
  }

  /**
   * Update display state from server for all agents.
   * Local player uses reconciliation (called separately via reconcileFromServer).
   * Other agents: always set to server position.
   */
  syncFromServer(
    agents: Iterable<[string, { x: number; y: number; facing: string }]>,
  ): void {
    const seen = new Set<string>();

    for (const [id, agent] of agents) {
      seen.add(id);
      if (id === this.localPlayerId) continue; // handled by reconcileFromServer
      const display = this.getOrCreate(id, agent.x, agent.y, agent.facing);
      display.displayX = agent.x;
      display.displayY = agent.y;
      display.facing = agent.facing;
    }

    for (const id of this.displays.keys()) {
      if (!seen.has(id)) {
        this.displays.delete(id);
      }
    }
  }

  updateRender(dt: number): void {
    const factor = 1 - Math.pow(1 - BASE_LERP_FACTOR, dt / BASE_FRAME_MS);

    for (const display of this.displays.values()) {
      const targetX = display.displayX * TILE_SIZE;
      const targetY = display.displayY * TILE_SIZE;
      display.renderX += (targetX - display.renderX) * factor;
      display.renderY += (targetY - display.renderY) * factor;
      if (Math.abs(display.renderX - targetX) < 0.5) display.renderX = targetX;
      if (Math.abs(display.renderY - targetY) < 0.5) display.renderY = targetY;
    }
  }

  get(id: string): AgentDisplay | undefined {
    return this.displays.get(id);
  }

  clear(): void {
    this.displays.clear();
    this.localPlayerId = null;
    this.tileSource = null;
  }

  private replayOne(
    display: AgentDisplay,
    targetX: number,
    targetY: number,
    direction: string,
    tiles: TileSource,
  ): void {
    // Turn-before-move
    if (direction !== display.facing) {
      display.facing = direction;
      return;
    }

    const tile = tiles.get(`${targetX},${targetY}`);
    if (tile) {
      const terrain = tile.terrain as TerrainType;
      if (terrain in TERRAIN_MOVE_COST && TERRAIN_MOVE_COST[terrain] === Infinity) {
        return;
      }
    }

    display.displayX = targetX;
    display.displayY = targetY;
  }

  private getOrCreate(id: string, initialX: number, initialY: number, facing = "south"): AgentDisplay {
    let display = this.displays.get(id);
    if (!display) {
      display = {
        displayX: initialX,
        displayY: initialY,
        renderX: initialX * TILE_SIZE,
        renderY: initialY * TILE_SIZE,
        facing,
      };
      this.displays.set(id, display);
    }
    return display;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- client/test/display.test.ts`
Expected: PASS (both old predictMove tests and new reconciliation tests)

**Updating existing predictMove tests:** The old tests call `syncFromServer` to initialise the local player display (e.g. `ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]])`). The new `syncFromServer` skips the local player. Replace these calls with `reconcileFromServer`:

```typescript
// OLD:
ds.syncFromServer([["p1", { x: 0, y: 0, facing: "south" }]]);

// NEW:
ds.setTileSource(makeTiles({}));
ds.reconcileFromServer("p1",
  { x: 0, y: 0, facing: "south", lastProcessedInput: 0, state: "idle" },
  [],
);
```

Apply this pattern to all existing tests that set a local player and call `syncFromServer`. Tests that only use non-local-player agents need no changes.

- [ ] **Step 5: Commit**

```bash
git add client/src/display.ts client/test/display.test.ts
git commit -m "feat: replace desync threshold with Gambetta reconciliation replay"
```

---

### Task 8: Rewrite InputHandler for per-tick move sends + pending buffer

**Files:**
- Modify: `client/src/input.ts:72-351`

- [ ] **Step 1: Add imports and new fields to InputHandler**

At the top of `client/src/input.ts`, add:

```typescript
import type { PendingInput } from "@town-zero/shared";
import { PENDING_INPUT_CAP, DIRECTION_DELTA } from "@town-zero/shared";
```

In the `InputHandler` class, replace lines 91-93 (the `onMoveStart`/`onMoveStop` callbacks):

```typescript
  // Movement reconciliation state
  inputSeq: number = 0;
  pendingInputs: PendingInput[] = [];

  // Network send callback for movement
  onSendMove: ((direction: string, seq: number) => void) | null = null;
  onSendMoveStop: ((seq: number) => void) | null = null;
```

- [ ] **Step 2: Rewrite `update()` method**

Replace the `update()` method (lines 168-195):

```typescript
  update(): void {
    if (!this.enabled || !this.playerAgent || this._dialogueMode) return;
    if (!this.displayState || !this.tiles) return;

    // Find the first held movement key
    for (const code of this.heldKeys) {
      const move = MOVE_KEYS[code];
      if (!move) continue;

      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;

      // Determine direction and send per-tick move message
      const direction = CODE_TO_DIRECTION[code];
      if (!direction) return;

      ++this.inputSeq;
      this.onSendMove?.(direction, this.inputSeq);

      // Local prediction
      const origin = this.displayState.getLocalPlayerPosition()
        ?? { x: this.playerAgent.x, y: this.playerAgent.y };
      const targetX = origin.x + move.dx;
      const targetY = origin.y + move.dy;

      this.displayState.predictMove(
        targetX, targetY, this.playerState, this.tiles,
      );

      // Always push regardless of predictMove result — the server may accept
      // moves the client rejects (different terrain knowledge). Reconciliation
      // handles correctness; gaps in the buffer cause desync.
      this.pendingInputs.push({ seq: this.inputSeq, direction: direction as any });

      // Safety valve
      if (this.pendingInputs.length > PENDING_INPUT_CAP) {
        this.pendingInputs = [];
      }

      return;
    }
  }
```

- [ ] **Step 3: Update `handleKey` — remove `onMoveStart` call**

In `handleKey` (around lines 239-243), replace:

```typescript
      if (direction && (wasEmpty || !e.repeat)) {
        this.onMoveStart?.(direction);
      }
```

with nothing — just remove those 3 lines. The per-tick `move` messages are now sent from `update()`, not from keydown. Keep the `heldKeys.add(code)` line.

- [ ] **Step 4: Update `handleKeyUp` — replace `onMoveStop` call**

In `handleKeyUp` (around lines 330-336), replace:

```typescript
      const nextMove = [...this.heldKeys].find((k) => k in MOVE_KEYS);
      if (nextMove) {
        const direction = CODE_TO_DIRECTION[nextMove];
        if (direction) this.onMoveStart?.(direction);
      } else {
        this.onMoveStop?.();
      }
```

with:

```typescript
      const nextMove = [...this.heldKeys].find((k) => k in MOVE_KEYS);
      if (!nextMove) {
        this.onSendMoveStop?.(this.inputSeq);
      }
```

- [ ] **Step 5: Update `handleBlur` and `enterDialogueMode`**

In `handleBlur` (line 104-108), replace `this.onMoveStop?.()` with `this.onSendMoveStop?.(this.inputSeq)`:

```typescript
  private handleBlur = (): void => {
    const hadMovement = [...this.heldKeys].some((k) => k in MOVE_KEYS);
    this.heldKeys.clear();
    if (hadMovement) this.onSendMoveStop?.(this.inputSeq);
  };
```

In `enterDialogueMode` (line 153-157), replace `this.onMoveStop?.()` with `this.onSendMoveStop?.(this.inputSeq)`:

```typescript
  enterDialogueMode(): void {
    this._dialogueMode = true;
    const hadMovement = [...this.heldKeys].some((k) => k in MOVE_KEYS);
    this.heldKeys.clear();
    if (hadMovement) this.onSendMoveStop?.(this.inputSeq);
  }
```

- [ ] **Step 6: Verify build**

Run: `pnpm run build`
Expected: may have type errors in `main.ts` (next task). Client build alone may not run — that's OK, we fix wiring next.

- [ ] **Step 7: Commit**

```bash
git add client/src/input.ts
git commit -m "feat: per-tick move sends with pending input buffer"
```

---

### Task 9: Update main.ts wiring

**Files:**
- Modify: `client/src/main.ts:234-235` (movement callback wiring)
- Modify: `client/src/main.ts:169-180` (game loop server sync)
- Modify: `client/src/main.ts:243` (prediction context)

- [ ] **Step 1: Update movement callback wiring**

Replace lines 234-235:

```typescript
    input.onMoveStart = (dir) => network.sendMoveStart(dir);
    input.onMoveStop = () => network.sendMoveStop();
```

with:

```typescript
    input.onSendMove = (dir, seq) => network.sendMove(dir, seq);
    input.onSendMoveStop = (seq) => network.sendMoveStop(seq);
```

- [ ] **Step 2: Update prediction context — pass tileSource to DisplayState**

Replace line 243:

```typescript
    input.setPredictionContext(displayState, fog.tileSource());
```

with:

```typescript
    displayState.setTileSource(fog.tileSource());
    input.setPredictionContext(displayState, fog.tileSource());
```

- [ ] **Step 3: Update game loop — add reconciliation call**

In the game loop (around lines 169-177), find where `displayState.syncFromServer` is called. The current code iterates over `state.agents` and calls `syncFromServer`. Replace the local player handling to use `reconcileFromServer`.

Find the existing sync block and replace with logic like:

```typescript
    // Sync non-local agents
    displayState.syncFromServer(
      Array.from(state.agents.entries()).map(([id, a]) => [id, { x: a.x, y: a.y, facing: a.facing }]),
    );

    // Reconcile local player
    if (input && network.playerId) {
      const localAgent = state.agents.get(network.playerId);
      if (localAgent) {
        input.pendingInputs = displayState.reconcileFromServer(
          network.playerId,
          {
            x: localAgent.x,
            y: localAgent.y,
            facing: localAgent.facing,
            lastProcessedInput: localAgent.lastProcessedInput,
            state: localAgent.state,
          },
          input.pendingInputs,
        );
      }
    }
```

Note: `localAgent.lastProcessedInput` reads from the Colyseus schema (AgentSchema), which automatically syncs from the server. Verify that the schema field is accessible (it should be, as we added it in Task 3).

- [ ] **Step 4: Remove snapLocalPlayer call from InputHandler.update**

The old `update()` called `this.displayState.snapLocalPlayer(...)` when no keys were held. This method no longer exists. Verify it was already removed in Task 8 Step 2 (the new `update()` has no else branch for "no movement keys held").

- [ ] **Step 5: Verify full build and run**

Run: `pnpm run build`
Expected: no errors

Run: `pnpm run dev:server` and `pnpm run dev:client` briefly to verify movement works.

- [ ] **Step 6: Commit**

```bash
git add client/src/main.ts
git commit -m "feat: wire reconciliation into game loop"
```

---

### Task 10: Run full test suite and fix any regressions

**Files:**
- All test files

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: ALL PASS. If any tests fail due to removed `heldDirection`, `snapLocalPlayer`, `MAX_DESYNC_TILES`, or changed `syncFromServer` signatures, fix them.

Common fixes:
- Tests that set `agent.heldDirection = "south"` → use `agent.enqueueMoveInput({ seq: 1, direction: "south" })` instead
- Tests that call `displayState.syncFromServer(...)` with local player data → may need to also call `reconcileFromServer`
- Tests that reference `MAX_DESYNC_TILES` → remove those assertions

- [ ] **Step 2: Fix any failing tests**

Update test code as needed to match new API.

- [ ] **Step 3: Run full test suite again**

Run: `pnpm run test`
Expected: ALL PASS

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: update tests for input sequence reconciliation API"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update development notes**

Replace the `Key-state movement` bullet in CLAUDE.md with:

```
- **Per-tick movement (Gambetta reconciliation):** Client sends `move` messages (with seq number) every 125ms while a key is held. Server consumes one from `agent.moveQueue` per tick, advancing `agent.lastProcessedInput`. Client reconciles by accepting server position as baseline, pruning acknowledged inputs, and replaying the rest. `move:stop` with seq flushes server queue and client buffer. No `heldDirection` — the key-state model was replaced
```

Also update the `display.ts` bullet to mention reconciliation:

```
- Client-side movement prediction (`display.ts`): `DisplayState` tracks predicted tile positions (`displayX/Y`) and lerped pixel positions (`renderX/Y`). `reconcileFromServer` accepts server state as baseline, prunes acknowledged pending inputs by seq, and replays unacknowledged ones. `updateRender(dt)` lerps pixel positions toward display positions
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for per-tick movement reconciliation model"
```
