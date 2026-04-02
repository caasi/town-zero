# Client-Side Movement Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player movement feel instant by predicting moves client-side, with smooth lerp animation for all agents.

**Architecture:** Introduce a client-only `AgentDisplay` map that tracks predicted/interpolated tile positions (`displayX/Y`) and pixel render positions (`renderX/Y`). The input handler validates moves locally using `TERRAIN_MOVE_COST` before sending to server. The renderer reads from `AgentDisplay` instead of raw Colyseus state. Frame-rate-independent lerp drives all animation.

**Tech Stack:** TypeScript, Canvas 2D, Colyseus SDK (state callbacks), `@town-zero/shared` (`TERRAIN_MOVE_COST`, `TerrainType`)

**Spec:** `docs/superpowers/specs/2026-04-03-movement-prediction-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `client/src/display.ts` | **Create** | `AgentDisplay` interface + `DisplayState` class (manages display map, lerp updates, prediction) |
| `client/src/input.ts` | Modify | Add local move validation (terrain check, bounds check, idle check) before sending commands |
| `client/src/renderer.ts` | Modify | Read from `DisplayState` pixel positions instead of Colyseus agent `x`/`y` |
| `client/src/camera.ts` | Modify | Accept float tile coords (already works — just update call site) |
| `client/src/main.ts` | Modify | Wire `DisplayState` into game loop, pass state + dt to display updates |
| `client/src/types.ts` | Modify | Export `AgentDisplay` interface (if needed outside display.ts) |

No server changes. No shared package changes.

**Spec deviation:** The spec mentions using Colyseus `callbacks.listen`/`callbacks.onChange` for reconciliation. This plan uses per-frame polling of `network.state.agents` instead — functionally equivalent, simpler to implement, and avoids callback lifecycle/cleanup complexity. The game loop already runs at 60fps, so the polling cost is negligible.

---

### Task 1: Create `DisplayState` module

The core data structure that tracks predicted/interpolated positions for all agents.

**Files:**
- Create: `client/src/display.ts`

- [ ] **Step 1: Create `display.ts` with `AgentDisplay` and `DisplayState`**

```typescript
// client/src/display.ts
import { TERRAIN_MOVE_COST } from "@town-zero/shared";
import type { TerrainType } from "@town-zero/shared";

const TILE_SIZE = 32;
const BASE_LERP_FACTOR = 0.2;
const BASE_FRAME_MS = 16.67; // 60fps baseline

export interface AgentDisplay {
  displayX: number;
  displayY: number;
  renderX: number;
  renderY: number;
}

export class DisplayState {
  private displays = new Map<string, AgentDisplay>();
  private localPlayerId: string | null = null;

  setLocalPlayer(id: string | null): void {
    this.localPlayerId = id;
  }

  /**
   * Returns the local player's current predicted position (displayX/Y),
   * or null if no local player or no display entry exists.
   * Used by InputHandler to compute the next move target from the
   * predicted position rather than the stale server position.
   */
  getLocalPlayerPosition(): { x: number; y: number } | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return { x: display.displayX, y: display.displayY };
  }

  /**
   * Attempt client-side predicted move for the local player.
   * Returns true if prediction was applied (caller should send command).
   * Returns false if move is invalid (caller should not send command).
   */
  predictMove(
    targetX: number,
    targetY: number,
    agentState: string,
    tiles: { get(key: string): { terrain: string } | undefined },
  ): boolean {
    if (!this.localPlayerId) return false;

    // Reject if agent is not idle
    if (agentState !== "idle") return false;

    // Reject if tile does not exist (out of bounds)
    const tile = tiles.get(`${targetX},${targetY}`);
    if (!tile) return false;

    // Reject if terrain is unknown or impassable
    const terrain = tile.terrain as TerrainType;
    if (!(terrain in TERRAIN_MOVE_COST)) return false;
    if (TERRAIN_MOVE_COST[terrain] === Infinity) return false;

    // Apply prediction: snap displayX/Y to target tile
    const display = this.getOrCreate(this.localPlayerId, targetX, targetY);
    display.displayX = targetX;
    display.displayY = targetY;
    return true;
  }

  /**
   * Called when server state arrives. Updates display targets for all agents.
   * For the local player: only updates if server disagrees with prediction.
   * For others: always updates display target.
   */
  syncFromServer(
    agents: Iterable<[string, { x: number; y: number }]>,
  ): void {
    const seen = new Set<string>();

    for (const [id, agent] of agents) {
      seen.add(id);
      const display = this.getOrCreate(id, agent.x, agent.y);

      if (id === this.localPlayerId) {
        // For local player, server is authoritative — override display target
        // The lerp in updateRender will smooth any correction
        display.displayX = agent.x;
        display.displayY = agent.y;
      } else {
        // For other agents, always track server position
        display.displayX = agent.x;
        display.displayY = agent.y;
      }
    }

    // Remove displays for agents that no longer exist
    for (const id of this.displays.keys()) {
      if (!seen.has(id)) this.displays.delete(id);
    }
  }

  /**
   * Called every animation frame. Lerps renderX/Y toward displayX/Y.
   * dt = milliseconds since last frame.
   */
  updateRender(dt: number): void {
    const factor = 1 - Math.pow(1 - BASE_LERP_FACTOR, dt / BASE_FRAME_MS);

    for (const display of this.displays.values()) {
      const targetX = display.displayX * TILE_SIZE;
      const targetY = display.displayY * TILE_SIZE;
      display.renderX += (targetX - display.renderX) * factor;
      display.renderY += (targetY - display.renderY) * factor;

      // Snap when close enough to avoid endless sub-pixel lerping
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
  }

  private getOrCreate(id: string, initialX: number, initialY: number): AgentDisplay {
    let display = this.displays.get(id);
    if (!display) {
      display = {
        displayX: initialX,
        displayY: initialY,
        renderX: initialX * TILE_SIZE,
        renderY: initialY * TILE_SIZE,
      };
      this.displays.set(id, display);
    }
    return display;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/display.ts
git commit -m "feat(client): add DisplayState module for movement prediction and lerp"
```

---

### Task 2: Wire `DisplayState` into the game loop

Connect `DisplayState` to `main.ts` — sync from server each frame, update lerp, track dt.

**Files:**
- Modify: `client/src/main.ts`

- [ ] **Step 1: Import `DisplayState` and initialize**

In `main.ts`, add import and create instance alongside other modules:

```typescript
import { DisplayState } from "./display.js";
```

Add after existing module declarations (after `const renderer = ...`):

```typescript
const displayState = new DisplayState();
```

- [ ] **Step 2: Set local player ID after connect**

In the `connect()` function, after `input = new InputHandler(...)`, add:

```typescript
displayState.setLocalPlayer(network.playerId);
```

- [ ] **Step 3: Add dt tracking and update display state in game loop**

Modify the `gameLoop` function to track delta time and update display:

Replace the existing `gameLoop` function:

```typescript
let lastFrameTime = performance.now();

function gameLoop(now: number): void {
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  if (gameState === "playing") {
    updateInputContext();
    updateHUD();

    // Sync display positions from server state
    if (network.state?.agents) {
      const entries: Array<[string, { x: number; y: number }]> = [];
      network.state.agents.forEach((agent: any) => {
        entries.push([agent.id, { x: agent.x, y: agent.y }]);
      });
      displayState.syncFromServer(entries);
    }

    // Lerp all render positions
    displayState.updateRender(dt);

    const player = network.state?.agents?.get(network.playerId ?? "");
    if (player) {
      // Camera follows lerped render position
      const playerDisplay = displayState.get(network.playerId!);
      if (playerDisplay) {
        camera.update(playerDisplay.renderX / 32 + 0.5, playerDisplay.renderY / 32 + 0.5);
      } else {
        camera.update(player.x, player.y);
      }
    }

    renderer.draw(network.state, fog, camera, network.playerId, displayState);
  }
  requestAnimationFrame(gameLoop);
}
```

Update the initial call from `requestAnimationFrame(gameLoop)` to `requestAnimationFrame(gameLoop)` (no change — `requestAnimationFrame` passes timestamp automatically).

- [ ] **Step 4: Clear display state on disconnect/reconnect**

In `connect()`, add `displayState.clear()` alongside `fog.clear()` (after the `isConnecting` guard, inside the try block):

```typescript
displayState.clear();
```

In the rejoin/retry click handlers, add `displayState.clear()` alongside `input?.destroy()`.

- [ ] **Step 5: Do NOT commit yet — renderer signature change (Task 4) is needed first to compile. Proceed to Task 3, then Task 4, then come back and commit all together in Task 4.**

---

### Task 3: Add local move validation to `InputHandler`

The input handler needs access to tile state and agent state to validate moves before predicting.

**Files:**
- Modify: `client/src/input.ts`

- [ ] **Step 1: Add `DisplayState` and tile state to `InputHandler`**

Add import at the top:

```typescript
import type { DisplayState } from "./display.js";
```

Add fields to `InputHandler`:

```typescript
private displayState: DisplayState | null = null;
private tiles: { get(key: string): { terrain: string } | undefined } | null = null;
private playerState: string = "idle";
```

Add setter method:

```typescript
setPredictionContext(
  displayState: DisplayState,
  tiles: { get(key: string): { terrain: string } | undefined },
): void {
  this.displayState = displayState;
  this.tiles = tiles;
}
```

Extend `setPlayerInfo` to accept `agentState`:

```typescript
setPlayerInfo(
  agent: AgentInfo | null,
  nearby: NearbyEntity[],
  settlementId: string | null,
  agentState?: string,
): void {
  this.playerAgent = agent;
  this.nearbyEntities = nearby;
  this.currentSettlementId = settlementId;
  this.playerState = agentState ?? "idle";
}
```

- [ ] **Step 2: Add prediction to move handling**

In `handleKey`, replace the movement block (the `if (move)` branch) with:

```typescript
    const move = MOVE_KEYS[code];
    if (move) {
      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;

      // Use predicted position as origin for next move (not stale server position).
      // This ensures rapid consecutive moves chain correctly (e.g. holding a key).
      const origin = this.displayState?.getLocalPlayerPosition()
        ?? { x: this.playerAgent.x, y: this.playerAgent.y };
      const targetX = origin.x + move.dx;
      const targetY = origin.y + move.dy;

      // Client-side prediction: validate and apply locally before sending
      if (this.displayState && this.tiles) {
        const predicted = this.displayState.predictMove(
          targetX, targetY, this.playerState, this.tiles,
        );
        if (!predicted) return; // Invalid move — don't send
      }

      this.send({
        type: "move",
        target: { x: targetX, y: targetY },
      });
      return;
    }
```

- [ ] **Step 3: Do NOT commit yet — proceed to Task 4 and commit together.**

---

### Task 4: Update renderer to use display positions

The renderer currently reads `agent.x`/`agent.y` directly from Colyseus state. Change it to read from `DisplayState` render positions.

**Files:**
- Modify: `client/src/renderer.ts`

- [ ] **Step 1: Add `DisplayState` import and update `draw` signature**

Add import:

```typescript
import type { DisplayState } from "./display.js";
```

Update the `draw` method signature:

```typescript
  draw(
    state: any,
    fog: FogManager,
    camera: Camera,
    playerId: string | null,
    displayState?: DisplayState,
  ): void {
```

- [ ] **Step 2: Use display positions for agent rendering**

In the agent drawing section (the `state.agents.forEach` block), replace the position calculation:

Replace:

```typescript
    if (state?.agents) {
      state.agents.forEach((agent: any) => {
        if (agent.x >= vp.startX && agent.x < vp.endX && agent.y >= vp.startY && agent.y < vp.endY) {
          const fl = fog.getLevel(agent.x, agent.y);
          if (fl !== "visible") return; // Only draw live agents on visible tiles
          const px = (agent.x - vp.startX) * TILE_SIZE + vp.offsetX;
          const py = (agent.y - vp.startY) * TILE_SIZE + vp.offsetY;
          this.drawAgent(ctx, px, py, agent, playerId, playerFaction, "visible");
        }
      });
    }
```

With:

```typescript
    if (state?.agents) {
      state.agents.forEach((agent: any) => {
        // Use lerped render position if available, else fall back to server position
        const display = displayState?.get(agent.id);
        const pxWorld = display ? display.renderX : agent.x * TILE_SIZE;
        const pyWorld = display ? display.renderY : agent.y * TILE_SIZE;

        // Convert from world pixel coords to screen coords
        const px = pxWorld - vp.startX * TILE_SIZE + vp.offsetX;
        const py = pyWorld - vp.startY * TILE_SIZE + vp.offsetY;

        // Visibility check uses the agent's tile (integer) position for fog
        const tileX = Math.round(pxWorld / TILE_SIZE);
        const tileY = Math.round(pyWorld / TILE_SIZE);
        const fl = fog.getLevel(tileX, tileY);
        if (fl !== "visible") return;

        // Cull agents outside viewport (with 1-tile margin for sliding agents)
        if (tileX < vp.startX - 1 || tileX > vp.endX || tileY < vp.startY - 1 || tileY > vp.endY) return;

        this.drawAgent(ctx, px, py, agent, playerId, playerFaction, "visible");
      });
    }
```

- [ ] **Step 3: Verify the full client compiles (Tasks 2-4 together)**

Run: `cd client && npx tsc --noEmit`
Expected: No errors — main.ts, input.ts, and renderer.ts all reference display.ts correctly now.

- [ ] **Step 4: Commit Tasks 2, 3, and 4 together**

```bash
git add client/src/main.ts client/src/input.ts client/src/renderer.ts
git commit -m "feat(client): wire DisplayState, prediction, and lerp rendering"
```

---

### Task 5: Wire prediction context in `main.ts` and pass agent state

Connect the remaining pieces: pass tile state and display state to input handler, pass agent state to `setPlayerInfo`.

**Files:**
- Modify: `client/src/main.ts`

- [ ] **Step 1: Pass prediction context to input handler after connect**

In `connect()`, after `input = new InputHandler(...)` and `input.setModalHandler(handleModal)`, add:

```typescript
input.setPredictionContext(displayState, network.state?.tiles);
```

- [ ] **Step 2: Pass agent state to `setPlayerInfo`**

In `updateInputContext()`, update the `input.setPlayerInfo` call to include agent state:

```typescript
  input.setPlayerInfo(
    { x: player.x, y: player.y, faction: player.faction },
    nearby,
    settlementId,
    player.state,  // FSM state for prediction gating
  );
```

- [ ] **Step 3: Verify everything compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run server tests to verify no regressions**

Run: `pnpm run test`
Expected: All 186 tests pass (no server changes were made)

- [ ] **Step 5: Commit**

```bash
git add client/src/main.ts client/src/input.ts
git commit -m "feat(client): connect prediction context and agent state to input handler"
```

---

### Task 6: Manual integration test

No automated client tests exist. Verify behavior manually.

**Files:** (none — testing only)

- [ ] **Step 1: Start server and client**

Run in separate terminals:
```bash
pnpm run dev:server
pnpm run dev:client
```

- [ ] **Step 2: Verify instant movement response**

Open `http://localhost:3000` in Chrome. Press WASD. The player diamond should slide immediately to the next tile without waiting for the server tick.

- [ ] **Step 3: Verify water/impassable rejection**

Move toward a water tile (bottom rows of the map, y=28-29). The player should not move or animate — the input is rejected locally.

- [ ] **Step 4: Verify server reconciliation**

If the server rejects a move for any reason (hard to trigger manually), the player should lerp back to the correct position smoothly rather than snapping.

- [ ] **Step 5: Verify other agents interpolate**

Join a second browser tab. Each player should see the other player's movement as smooth slides rather than tile jumps.

- [ ] **Step 6: Verify camera follows smoothly**

The camera should track the player's lerped position, not the server integer position. Movement should feel smooth without camera jitter.

- [ ] **Step 7: Commit final state**

If any adjustments were needed during testing, commit them:

```bash
git add -A
git commit -m "fix(client): adjust movement prediction after manual testing"
```
