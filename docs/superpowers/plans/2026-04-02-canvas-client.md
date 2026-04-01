# Canvas 2D Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal ChatRoom client with a playable Canvas 2D game client that connects to GameRoom, renders the world with three-tier fog of war, and lets players control their agent via keyboard.

**Architecture:** Thin Client with six modules (network, fog, camera, input, renderer, main). All state from server via Colyseus schema sync + vision messages. Canvas 2D rendering at 60fps via rAF, decoupled from 1s server tick. HUD via DOM overlay.

**Tech Stack:** Vite, TypeScript (strict), @colyseus/sdk 0.17.x, Canvas 2D, @town-zero/shared

**Spec:** `docs/superpowers/specs/2026-04-02-canvas-client-design.md`

**Prerequisite:** The Colyseus wiring plan (`docs/superpowers/plans/2026-04-01-colyseus-wiring.md`) must be completed first. The `feat/colyseus-wiring` branch (PR #2) contains GameRoom, schemas, and sync logic that this plan depends on. Execute this plan on that branch or after it is merged to main.

---

### Task 1: Server — send "joined" message with agentId

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`
- Modify: `server/test/rooms/game-room.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `server/test/rooms/game-room.test.ts`:

```typescript
it("sends joined message with agentId on join", () => {
  const client = mockClient("session-1");
  joinClient(room, client, { name: "Joiner" });

  const joinedMsgs = client.messages.filter((m: any) => m.type === "joined");
  expect(joinedMsgs).toHaveLength(1);
  expect(joinedMsgs[0].data.agentId).toMatch(/^player-/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm exec vitest run test/rooms/game-room.test.ts`
Expected: FAIL — no "joined" message sent

- [ ] **Step 3: Add client.send("joined") to GameRoom.onJoin**

In `server/src/rooms/GameRoom.ts`, in `onJoin`, after `this.sessionToAgent.set(client.sessionId, id)`, add:

```typescript
client.send("joined", { agentId: id });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm exec vitest run test/rooms/game-room.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server test suite**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/test/rooms/game-room.test.ts
git commit -m "feat: send joined message with agentId on player join"
```

---

### Task 2: Client types

**Files:**
- Create: `client/src/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// client/src/types.ts
import type { TerrainType, EntitySnapshot, ActionCommand } from "@town-zero/shared";

export type FogLevel = "visible" | "explored" | "unknown";

export interface FogEntry {
  level: FogLevel;
  terrain: TerrainType;
  lastEntities: EntitySnapshot[];
  timestamp: number;
}

export interface VisionData {
  tick: number;
  tiles: Record<string, {
    terrain: TerrainType;
    entities: EntitySnapshot[];
    timestamp: number;
  }>;
}

export interface Viewport {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  offsetX: number;
  offsetY: number;
}

export type GameState = "connecting" | "playing" | "dead" | "error";

export type ModalRequest =
  | { type: "trade"; merchantId: string }
  | { type: "dialogue"; targetId: string };

export type { ActionCommand, TerrainType, EntitySnapshot };
```

- [ ] **Step 2: Commit**

```bash
git add client/src/types.ts
git commit -m "feat: add client-side type definitions"
```

---

### Task 3: Camera module

**Files:**
- Create: `client/src/camera.ts`

- [ ] **Step 1: Create camera.ts**

```typescript
// client/src/camera.ts
import type { Viewport } from "./types.js";

const TILE_SIZE = 32;

export class Camera {
  private canvasWidth = 0;
  private canvasHeight = 0;
  private gridWidth = 0;
  private gridHeight = 0;
  private viewport: Viewport = { startX: 0, startY: 0, endX: 0, endY: 0, offsetX: 0, offsetY: 0 };

  setCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  setGridSize(width: number, height: number): void {
    this.gridWidth = width;
    this.gridHeight = height;
  }

  update(playerX: number, playerY: number): void {
    const tilesX = Math.ceil(this.canvasWidth / TILE_SIZE) + 1;
    const tilesY = Math.ceil(this.canvasHeight / TILE_SIZE) + 1;

    const halfW = tilesX / 2;
    const halfH = tilesY / 2;

    let startX = Math.floor(playerX - halfW + 0.5);
    let startY = Math.floor(playerY - halfH + 0.5);

    // Clamp to grid bounds
    startX = Math.max(0, Math.min(startX, this.gridWidth - tilesX));
    startY = Math.max(0, Math.min(startY, this.gridHeight - tilesY));

    const endX = Math.min(startX + tilesX, this.gridWidth);
    const endY = Math.min(startY + tilesY, this.gridHeight);

    // Pixel offset for centering
    const offsetX = (this.canvasWidth / 2) - (playerX - startX + 0.5) * TILE_SIZE;
    const offsetY = (this.canvasHeight / 2) - (playerY - startY + 0.5) * TILE_SIZE;

    this.viewport = { startX, startY, endX, endY, offsetX, offsetY };
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  getTileSize(): number {
    return TILE_SIZE;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/camera.ts
git commit -m "feat: add camera module with player-centered viewport"
```

---

### Task 4: Fog manager

**Files:**
- Create: `client/src/fog.ts`

- [ ] **Step 1: Create fog.ts**

```typescript
// client/src/fog.ts
import type { FogLevel, FogEntry, VisionData } from "./types.js";

export class FogManager {
  private entries = new Map<string, FogEntry>();

  update(vision: VisionData): void {
    const currentTick = vision.tick;
    for (const [key, tile] of Object.entries(vision.tiles)) {
      this.entries.set(key, {
        level: tile.timestamp === currentTick ? "visible" : "explored",
        terrain: tile.terrain,
        lastEntities: tile.entities,
        timestamp: tile.timestamp,
      });
    }
  }

  getLevel(x: number, y: number): FogLevel {
    return this.entries.get(`${x},${y}`)?.level ?? "unknown";
  }

  getEntry(x: number, y: number): FogEntry | undefined {
    return this.entries.get(`${x},${y}`);
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/fog.ts
git commit -m "feat: add fog manager with three-tier fog of war"
```

---

### Task 5: Network module

**Files:**
- Create: `client/src/network.ts`

- [ ] **Step 1: Create network.ts**

```typescript
// client/src/network.ts
import { Client, Room } from "@colyseus/sdk";
import type { ActionCommand } from "@town-zero/shared";
import type { VisionData } from "./types.js";

export class NetworkClient {
  private room: Room | null = null;
  private _playerId: string | null = null;
  private visionCallbacks: Array<(data: VisionData) => void> = [];
  private deathCallbacks: Array<(agentId: string) => void> = [];
  private joinedResolve: ((agentId: string) => void) | null = null;

  get state(): any {
    return this.room?.state ?? null;
  }

  get playerId(): string | null {
    return this._playerId;
  }

  async connect(name: string): Promise<void> {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const client = new Client(`${protocol}://${window.location.hostname}:2567`);
    this.room = await client.joinOrCreate("game", { name });

    const joinedPromise = new Promise<string>((resolve) => {
      this.joinedResolve = resolve;
    });

    this.room.onMessage("joined", (data: { agentId: string }) => {
      this._playerId = data.agentId;
      if (this.joinedResolve) {
        this.joinedResolve(data.agentId);
        this.joinedResolve = null;
      }
    });

    this.room.onMessage("vision", (data: VisionData) => {
      for (const cb of this.visionCallbacks) cb(data);
    });

    this.room.onMessage("death", (data: { agentId: string }) => {
      for (const cb of this.deathCallbacks) cb(data.agentId);
    });

    await joinedPromise;
  }

  send(cmd: ActionCommand): void {
    this.room?.send("command", cmd);
  }

  onVision(cb: (data: VisionData) => void): void {
    this.visionCallbacks.push(cb);
  }

  onDeath(cb: (agentId: string) => void): void {
    this.deathCallbacks.push(cb);
  }

  disconnect(): void {
    this.room?.leave();
    this.room = null;
    this._playerId = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/network.ts
git commit -m "feat: add network module with Colyseus GameRoom connection"
```

---

### Task 6: Input handler

**Files:**
- Create: `client/src/input.ts`

- [ ] **Step 1: Create input.ts**

```typescript
// client/src/input.ts
import type { ActionCommand } from "@town-zero/shared";
import type { ModalRequest } from "./types.js";

export type SendFn = (cmd: ActionCommand) => void;

interface AgentInfo {
  x: number;
  y: number;
  faction: string;
}

interface NearbyEntity {
  id: string;
  x: number;
  y: number;
  faction: string;
  role: string;
  controller: string;
  hp: number;
}

const MOVE_THROTTLE_MS = 200;

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  w: { dx: 0, dy: -1 }, arrowup: { dx: 0, dy: -1 },
  a: { dx: -1, dy: 0 }, arrowleft: { dx: -1, dy: 0 },
  s: { dx: 0, dy: 1 },  arrowdown: { dx: 0, dy: 1 },
  d: { dx: 1, dy: 0 },  arrowright: { dx: 1, dy: 0 },
};

export class InputHandler {
  private send: SendFn;
  private lastMoveTime = 0;
  private enabled = true;
  private onModal: ((req: ModalRequest) => void) | null = null;

  // Updated each tick by main loop
  private playerAgent: AgentInfo | null = null;
  private nearbyEntities: NearbyEntity[] = [];
  private currentSettlementId: string | null = null;

  constructor(send: SendFn) {
    this.send = send;
    this.handleKey = this.handleKey.bind(this);
    window.addEventListener("keydown", this.handleKey);
  }

  setPlayerInfo(agent: AgentInfo | null, nearby: NearbyEntity[], settlementId: string | null): void {
    this.playerAgent = agent;
    this.nearbyEntities = nearby;
    this.currentSettlementId = settlementId;
  }

  setModalHandler(handler: (req: ModalRequest) => void): void {
    this.onModal = handler;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.enabled || !this.playerAgent) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();

    // WASD / arrow movement
    const move = MOVE_KEYS[key];
    if (move) {
      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;
      this.send({
        type: "move",
        target: { x: this.playerAgent.x + move.dx, y: this.playerAgent.y + move.dy },
      });
      return;
    }

    const { x, y, faction } = this.playerAgent;

    switch (key) {
      case "q": {
        // Attack nearest adjacent enemy
        const enemy = this.nearbyEntities.find(
          (e) => e.faction !== faction && e.hp > 0 && this.isAdjacent(x, y, e.x, e.y),
        );
        if (enemy) this.send({ type: "attack", targetId: enemy.id });
        break;
      }
      case "g":
        this.send({ type: "gather", resourceTile: { x, y } });
        break;
      case "t":
        if (this.currentSettlementId) {
          this.send({ type: "deposit", settlementId: this.currentSettlementId });
        }
        break;
      case "e":
        this.handleInteract();
        break;
    }
  }

  private handleInteract(): void {
    if (!this.playerAgent) return;
    const { x, y, faction } = this.playerAgent;

    // 1. Adjacent merchant
    const merchant = this.nearbyEntities.find(
      (e) => e.role === "merchant" && this.isAdjacent(x, y, e.x, e.y),
    );
    if (merchant) {
      this.onModal?.({ type: "trade", merchantId: merchant.id });
      return;
    }

    // 2. Adjacent same-faction NPC
    const npc = this.nearbyEntities.find(
      (e) => e.faction === faction && e.controller !== "player" && e.hp > 0
        && this.isAdjacent(x, y, e.x, e.y),
    );
    if (npc) {
      this.send({ type: "talk", targetId: npc.id, optionId: "greet" });
      return;
    }

    // 3. Standing on settlement
    if (this.currentSettlementId) {
      this.send({ type: "take", settlementId: this.currentSettlementId, resource: "food", amount: 1 });
    }
  }

  private isAdjacent(x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKey);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/input.ts
git commit -m "feat: add input handler with WASD movement and action keys"
```

---

### Task 7: Renderer

**Files:**
- Create: `client/src/renderer.ts`

- [ ] **Step 1: Create renderer.ts**

```typescript
// client/src/renderer.ts
import type { Viewport, FogLevel } from "./types.js";
import type { FogManager } from "./fog.js";
import type { Camera } from "./camera.js";

const TILE_SIZE = 32;

const TERRAIN_COLORS: Record<string, string> = {
  plains: "#3a6a3e",
  forest: "#1a4a1a",
  mountain: "#7a6a5a",
  water: "#1a4a7a",
  road: "#b8a87a",
};

const FOG_ALPHA: Record<FogLevel, number> = {
  visible: 0,
  explored: 0.5,
  unknown: 0.9,
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  draw(
    state: any,
    fog: FogManager,
    camera: Camera,
    playerId: string | null,
  ): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const vp = camera.getViewport();

    // Extract player faction for enemy detection
    let playerFaction = "";
    if (playerId && state?.agents) {
      const pa = state.agents.get(playerId);
      if (pa) playerFaction = pa.faction;
    }

    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, width, height);

    // Draw tiles
    for (let y = vp.startY; y < vp.endY; y++) {
      for (let x = vp.startX; x < vp.endX; x++) {
        const px = (x - vp.startX) * TILE_SIZE + vp.offsetX;
        const py = (y - vp.startY) * TILE_SIZE + vp.offsetY;
        const fogLevel = fog.getLevel(x, y);

        this.drawTile(ctx, px, py, state, x, y, fogLevel);
      }
    }

    // Draw settlements
    if (state?.settlements) {
      state.settlements.forEach((s: any) => {
        if (s.x >= vp.startX && s.x < vp.endX && s.y >= vp.startY && s.y < vp.endY) {
          const fl = fog.getLevel(s.x, s.y);
          if (fl === "unknown") return;
          const px = (s.x - vp.startX) * TILE_SIZE + vp.offsetX;
          const py = (s.y - vp.startY) * TILE_SIZE + vp.offsetY;
          this.drawSettlement(ctx, px, py, s, fl);
        }
      });
    }

    // Draw agents on visible tiles (from live server state)
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

    // Draw remembered entities on explored tiles (from fog memory)
    for (let y = vp.startY; y < vp.endY; y++) {
      for (let x = vp.startX; x < vp.endX; x++) {
        const fl = fog.getLevel(x, y);
        if (fl !== "explored") continue;
        const entry = fog.getEntry(x, y);
        if (!entry?.lastEntities.length) continue;
        const px = (x - vp.startX) * TILE_SIZE + vp.offsetX;
        const py = (y - vp.startY) * TILE_SIZE + vp.offsetY;
        for (const entity of entry.lastEntities) {
          this.drawFogEntity(ctx, px, py, entity, playerFaction);
        }
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    state: any, x: number, y: number, fogLevel: FogLevel,
  ): void {
    // Get terrain from state tiles or fog entry
    let terrain = "plains";
    let resourceYield = "";
    if (state?.tiles) {
      const tile = state.tiles.get(`${x},${y}`);
      if (tile) {
        terrain = tile.terrain || "plains";
        resourceYield = tile.resourceYield || "";
      }
    }

    // Base color
    ctx.fillStyle = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS.plains;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    // Terrain patterns (only if not unknown)
    if (fogLevel !== "unknown") {
      this.drawTerrainPattern(ctx, px, py, terrain);
    }

    // Resource yield dot
    if (fogLevel !== "unknown" && resourceYield) {
      ctx.fillStyle = resourceYield === "food" ? "#6a6" : "#a86";
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE - 6, py + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

    // Fog overlay
    const alpha = FOG_ALPHA[fogLevel];
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  private drawTerrainPattern(ctx: CanvasRenderingContext2D, px: number, py: number, terrain: string): void {
    switch (terrain) {
      case "forest":
        ctx.fillStyle = "#0a3a0a";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(px + 6 + i * 10, py + 10 + (i % 2) * 10, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "mountain":
        ctx.fillStyle = "#5a4a3a";
        ctx.beginPath();
        ctx.moveTo(px + 8, py + TILE_SIZE - 4);
        ctx.lineTo(px + 16, py + 6);
        ctx.lineTo(px + 24, py + TILE_SIZE - 4);
        ctx.closePath();
        ctx.fill();
        break;
      case "water":
        ctx.strokeStyle = "#3a6a9a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 16);
        ctx.quadraticCurveTo(px + 16, py + 10, px + 28, py + 16);
        ctx.stroke();
        break;
      case "road":
        ctx.strokeStyle = "#a8986a";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px + TILE_SIZE / 2, py);
        ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
    }
  }

  private drawSettlement(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    settlement: any, fogLevel: FogLevel,
  ): void {
    const color = settlement.type === "village" ? "#d4a037" : "#8a4a8a";
    ctx.globalAlpha = fogLevel === "explored" ? 0.5 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.3;
    ctx.fillRect(px + 3, py + 3, TILE_SIZE - 6, TILE_SIZE - 6);
    ctx.globalAlpha = 1;
  }

  private drawAgent(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    agent: any, playerId: string | null, playerFaction: string, fogLevel: FogLevel,
  ): void {
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    const isPlayer = agent.id === playerId;
    const isDead = agent.state === "dead" || agent.hp <= 0;

    ctx.globalAlpha = isDead ? 0.5 : 1;

    if (agent.role === "merchant") {
      // Circle - merchant
      ctx.fillStyle = "#da3";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE / 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (isPlayer) {
      // Diamond - player (only on visible tiles)
      ctx.fillStyle = "#4af";
      ctx.beginPath();
      ctx.moveTo(cx, py + 3);
      ctx.lineTo(px + TILE_SIZE - 3, cy);
      ctx.lineTo(cx, py + TILE_SIZE - 3);
      ctx.lineTo(px + 3, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Triangle - other agents
      const isEnemy = playerFaction !== "" && agent.faction !== playerFaction;
      ctx.fillStyle = isEnemy ? "#c44" : "#6c6";
      ctx.beginPath();
      ctx.moveTo(cx, py + 4);
      ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
      ctx.lineTo(px + 4, py + TILE_SIZE - 4);
      ctx.closePath();
      ctx.fill();
      if (!isEnemy) {
        ctx.strokeStyle = "#3a3";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Dead X mark
    if (isDead) {
      ctx.strokeStyle = "#f00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8);
      ctx.lineTo(px + TILE_SIZE - 8, py + TILE_SIZE - 8);
      ctx.moveTo(px + TILE_SIZE - 8, py + 8);
      ctx.lineTo(px + 8, py + TILE_SIZE - 8);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /** Draw entity from fog memory on explored tiles — all agents as triangles, merchants as circles */
  private drawFogEntity(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    entity: { id: string; type: string; faction: string; position: { x: number; y: number } },
    playerFaction: string,
  ): void {
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    ctx.globalAlpha = 0.4;

    if (entity.type === "merchant") {
      ctx.fillStyle = "#da3";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE / 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // All agents render as triangles in fog (no diamond distinction)
      const isEnemy = playerFaction !== "" && entity.faction !== playerFaction;
      ctx.fillStyle = isEnemy ? "#c44" : "#6c6";
      ctx.beginPath();
      ctx.moveTo(cx, py + 4);
      ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
      ctx.lineTo(px + 4, py + TILE_SIZE - 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/renderer.ts
git commit -m "feat: add Canvas 2D renderer with terrain patterns and entity shapes"
```

---

### Task 8: HTML + HUD structure

**Files:**
- Rewrite: `client/index.html`

- [ ] **Step 1: Rewrite index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>town-zero</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #111; }
    #game-container {
      position: relative; width: 100%; height: 100%;
    }
    #game-canvas {
      display: block; width: 100%; height: 100%;
    }

    /* HUD overlay */
    #hud {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; font: 14px monospace; color: #eee;
    }
    #hud > * { pointer-events: auto; }

    #hud-top-left {
      position: absolute; top: 12px; left: 12px;
    }
    #hp-bar-container {
      width: 120px; height: 12px; background: #333; border: 1px solid #555;
      margin-bottom: 4px;
    }
    #hp-bar {
      height: 100%; background: #4a4; transition: width 0.3s;
    }
    #hp-text { font-size: 12px; margin-bottom: 6px; }
    #inventory { font-size: 13px; }

    #key-hints {
      position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
      font-size: 12px; color: #888; background: rgba(0,0,0,0.6);
      padding: 4px 12px; border-radius: 4px;
    }

    /* Overlays */
    .overlay {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7); font: 20px monospace; color: #eee;
      flex-direction: column; gap: 16px;
    }
    .overlay.hidden { display: none; }
    .overlay button {
      font: 16px monospace; padding: 8px 20px; cursor: pointer;
      background: #333; color: #eee; border: 1px solid #666;
    }
    .overlay button:hover { background: #555; }

    /* Trade modal */
    #trade-modal {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #222; border: 1px solid #555; padding: 20px;
      font: 14px monospace; color: #eee; min-width: 240px;
    }
    #trade-modal.hidden { display: none; }
    #trade-modal h3 { margin-bottom: 12px; }
    #trade-modal button {
      display: block; width: 100%; margin-bottom: 8px;
      font: 14px monospace; padding: 8px; cursor: pointer;
      background: #333; color: #eee; border: 1px solid #555;
    }
    #trade-modal button:hover { background: #555; }
  </style>
</head>
<body>
  <div id="game-container">
    <canvas id="game-canvas"></canvas>
    <div id="hud">
      <div id="hud-top-left">
        <div id="hp-text">HP: 100/100</div>
        <div id="hp-bar-container"><div id="hp-bar" style="width:100%"></div></div>
        <div id="inventory">🍖0 🪵0 💰0</div>
      </div>
      <div id="key-hints">WASD:Move  E:Interact  Q:Attack  G:Gather  T:Deposit</div>
    </div>

    <div id="connecting-overlay" class="overlay">Connecting...</div>
    <div id="death-overlay" class="overlay hidden">
      <div>You Died</div>
      <button id="rejoin-btn">Rejoin</button>
    </div>
    <div id="error-overlay" class="overlay hidden">
      <div id="error-text">Connection failed</div>
      <button id="retry-btn">Retry</button>
    </div>

    <div id="trade-modal" class="hidden">
      <h3>Trade with Merchant</h3>
      <p style="margin-bottom:12px;font-size:12px;color:#aaa">Exchange rate: 2 resources → 1 currency</p>
      <button id="sell-food-btn">Sell Food (2 → 1💰)</button>
      <button id="sell-material-btn">Sell Material (2 → 1💰)</button>
      <button id="close-trade-btn">Close (Esc)</button>
    </div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add client/index.html
git commit -m "feat: replace ChatRoom HTML with canvas game layout and HUD"
```

---

### Task 9: Main entry point — wire everything together

**Files:**
- Rewrite: `client/src/main.ts`

- [ ] **Step 1: Rewrite main.ts**

```typescript
// client/src/main.ts
import { MERCHANT_TRADE_RATE } from "@town-zero/shared";
import { NetworkClient } from "./network.js";
import { FogManager } from "./fog.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import type { GameState, ModalRequest } from "./types.js";

// DOM elements
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const connectingOverlay = document.getElementById("connecting-overlay")!;
const deathOverlay = document.getElementById("death-overlay")!;
const errorOverlay = document.getElementById("error-overlay")!;
const errorText = document.getElementById("error-text")!;
const tradeModal = document.getElementById("trade-modal")!;
const hpText = document.getElementById("hp-text")!;
const hpBar = document.getElementById("hp-bar")!;
const inventoryEl = document.getElementById("inventory")!;

// Modules
const network = new NetworkClient();
const fog = new FogManager();
const camera = new Camera();
const renderer = new Renderer(canvas);

let gameState: GameState = "connecting";
let input: InputHandler | null = null;
let currentTradeTarget: string | null = null;

// Resize canvas to fill window
function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.setCanvasSize(canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// HUD update
function updateHUD(): void {
  const state = network.state;
  const playerId = network.playerId;
  if (!state || !playerId) return;

  const agent = state.agents?.get(playerId);
  if (!agent) return;

  hpText.textContent = `HP: ${agent.hp}/${agent.maxHp}`;
  const pct = Math.max(0, (agent.hp / agent.maxHp) * 100);
  hpBar.style.width = `${pct}%`;
  hpBar.style.background = pct > 50 ? "#4a4" : pct > 25 ? "#aa4" : "#a44";

  const food = agent.inventory?.get("food") ?? 0;
  const material = agent.inventory?.get("material") ?? 0;
  const currency = agent.inventory?.get("currency") ?? 0;
  inventoryEl.textContent = `🍖${food} 🪵${material} 💰${currency}`;
}

// Get nearby entities for input handler
function updateInputContext(): void {
  if (!input || !network.state || !network.playerId) return;
  const state = network.state;
  const player = state.agents?.get(network.playerId);
  if (!player) return;

  const nearby: any[] = [];
  state.agents?.forEach((agent: any) => {
    if (agent.id !== network.playerId) {
      nearby.push({
        id: agent.id, x: agent.x, y: agent.y,
        faction: agent.faction, role: agent.role,
        controller: agent.controller, hp: agent.hp,
      });
    }
  });

  // Find settlement at player position
  let settlementId: string | null = null;
  const playerTile = state.tiles?.get(`${player.x},${player.y}`);
  if (playerTile?.ownerFaction) {
    state.settlements?.forEach((s: any) => {
      if (s.faction === playerTile.ownerFaction) settlementId = s.id;
    });
  }

  input.setPlayerInfo(
    { x: player.x, y: player.y, faction: player.faction },
    nearby,
    settlementId,
  );
}

// Trade modal
function openTradeModal(merchantId: string): void {
  currentTradeTarget = merchantId;
  tradeModal.classList.remove("hidden");
}

function closeTradeModal(): void {
  currentTradeTarget = null;
  tradeModal.classList.add("hidden");
}

document.getElementById("sell-food-btn")!.addEventListener("click", () => {
  if (currentTradeTarget) {
    network.send({
      type: "trade", targetId: currentTradeTarget,
      offer: "food", offerAmount: MERCHANT_TRADE_RATE,
      want: "currency", wantAmount: 1,
    });
    closeTradeModal();
  }
});

document.getElementById("sell-material-btn")!.addEventListener("click", () => {
  if (currentTradeTarget) {
    network.send({
      type: "trade", targetId: currentTradeTarget,
      offer: "material", offerAmount: MERCHANT_TRADE_RATE,
      want: "currency", wantAmount: 1,
    });
    closeTradeModal();
  }
});

document.getElementById("close-trade-btn")!.addEventListener("click", closeTradeModal);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTradeModal();
});

// Modal handler for input
function handleModal(req: ModalRequest): void {
  if (req.type === "trade") {
    openTradeModal(req.merchantId);
  } else if (req.type === "dialogue") {
    network.send({ type: "talk", targetId: req.targetId, optionId: "greet" });
  }
}

// Overlay management
function setOverlay(state: GameState): void {
  connectingOverlay.classList.toggle("hidden", state !== "connecting");
  deathOverlay.classList.toggle("hidden", state !== "dead");
  errorOverlay.classList.toggle("hidden", state !== "error");
}

// Game loop
function gameLoop(): void {
  if (gameState === "playing") {
    updateInputContext();
    updateHUD();

    const player = network.state?.agents?.get(network.playerId ?? "");
    if (player) {
      camera.update(player.x, player.y);
    }

    renderer.draw(network.state, fog, camera, network.playerId);
  }
  requestAnimationFrame(gameLoop);
}

// Connect
async function connect(): Promise<void> {
  gameState = "connecting";
  setOverlay("connecting");
  fog.clear();

  try {
    await network.connect("Player");

    const state = network.state;
    if (state) {
      camera.setGridSize(state.width, state.height);
    }

    input = new InputHandler((cmd) => network.send(cmd));
    input.setModalHandler(handleModal);

    network.onVision((vision) => fog.update(vision));
    network.onDeath(() => {
      gameState = "dead";
      setOverlay("dead");
      input?.setEnabled(false);
    });

    gameState = "playing";
    setOverlay("playing");
  } catch (err: any) {
    gameState = "error";
    errorText.textContent = `Connection failed: ${err.message ?? err}`;
    setOverlay("error");
  }
}

// Rejoin / retry buttons
document.getElementById("rejoin-btn")!.addEventListener("click", () => {
  network.disconnect();
  input?.destroy();
  connect();
});

document.getElementById("retry-btn")!.addEventListener("click", () => {
  connect();
});

// Start
requestAnimationFrame(gameLoop);
connect();
```

- [ ] **Step 2: Commit**

```bash
git add client/src/main.ts
git commit -m "feat: wire all client modules into main game loop"
```

---

### Task 10: Manual smoke test

- [ ] **Step 1: Build shared package**

Run: `cd shared && pnpm exec tsc`

- [ ] **Step 2: Start the server**

Run: `pnpm run dev:server`
Expected: Console shows "town-zero server listening on port 2567"

- [ ] **Step 3: Start the client**

In another terminal: `pnpm run dev:client`
Expected: Vite dev server on port 3000

- [ ] **Step 4: Open browser and test**

Open `http://localhost:3000`. Expected:
- "Connecting..." overlay appears briefly
- Canvas renders 40×40 grid with terrain patterns
- Player (blue diamond) appears in village area
- Bot agents (green triangles) visible nearby
- WASD moves the player (after ~1s server tick)
- HUD shows HP and inventory
- Three-tier fog of war: bright near player, dim further out, black for unexplored

- [ ] **Step 5: Fix any issues found during smoke test**

If compilation or runtime errors occur, fix them and commit.

- [ ] **Step 6: Run server tests to verify no regressions**

Run: `cd server && pnpm exec vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: smoke test adjustments for canvas client"
```

---

### Task 11: Unit tests for FogManager and Camera

**Files:**
- Create: `client/test/fog.test.ts`
- Create: `client/test/camera.test.ts`
- Modify: `client/package.json` (add vitest dev dependency + test script)

- [ ] **Step 1: Add vitest to client**

```bash
cd /path/to/project && pnpm add --filter @town-zero/client --save-dev vitest
```

Add to `client/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 2: Write FogManager tests**

```typescript
// client/test/fog.test.ts
import { describe, it, expect } from "vitest";
import { FogManager } from "../src/fog.js";
import type { VisionData } from "../src/types.js";

describe("FogManager", () => {
  it("returns unknown for unseen tiles", () => {
    const fog = new FogManager();
    expect(fog.getLevel(5, 5)).toBe("unknown");
    expect(fog.getEntry(5, 5)).toBeUndefined();
  });

  it("marks tiles with current timestamp as visible", () => {
    const fog = new FogManager();
    const vision: VisionData = {
      tick: 10,
      tiles: {
        "3,4": { terrain: "forest", entities: [], timestamp: 10 },
        "5,5": { terrain: "plains", entities: [], timestamp: 10 },
      },
    };
    fog.update(vision);
    expect(fog.getLevel(3, 4)).toBe("visible");
    expect(fog.getLevel(5, 5)).toBe("visible");
    expect(fog.getEntry(3, 4)?.terrain).toBe("forest");
  });

  it("marks tiles with old timestamp as explored", () => {
    const fog = new FogManager();
    const vision: VisionData = {
      tick: 10,
      tiles: {
        "3,4": { terrain: "forest", entities: [], timestamp: 5 },
      },
    };
    fog.update(vision);
    expect(fog.getLevel(3, 4)).toBe("explored");
  });

  it("transitions visible to explored on next tick", () => {
    const fog = new FogManager();
    fog.update({
      tick: 1,
      tiles: { "3,4": { terrain: "forest", entities: [], timestamp: 1 } },
    });
    expect(fog.getLevel(3, 4)).toBe("visible");

    fog.update({
      tick: 2,
      tiles: { "3,4": { terrain: "forest", entities: [], timestamp: 1 } },
    });
    expect(fog.getLevel(3, 4)).toBe("explored");
  });

  it("stores last known entities", () => {
    const fog = new FogManager();
    const entities = [{ id: "a1", type: "agent", faction: "village-1", position: { x: 3, y: 4 } }];
    fog.update({
      tick: 5,
      tiles: { "3,4": { terrain: "forest", entities, timestamp: 5 } },
    });
    expect(fog.getEntry(3, 4)?.lastEntities).toHaveLength(1);
    expect(fog.getEntry(3, 4)?.lastEntities[0].id).toBe("a1");
  });

  it("clear resets all entries", () => {
    const fog = new FogManager();
    fog.update({
      tick: 1,
      tiles: { "0,0": { terrain: "plains", entities: [], timestamp: 1 } },
    });
    expect(fog.getLevel(0, 0)).toBe("visible");
    fog.clear();
    expect(fog.getLevel(0, 0)).toBe("unknown");
  });
});
```

- [ ] **Step 3: Write Camera tests**

```typescript
// client/test/camera.test.ts
import { describe, it, expect } from "vitest";
import { Camera } from "../src/camera.js";

describe("Camera", () => {
  it("returns a viewport centered on player", () => {
    const cam = new Camera();
    cam.setCanvasSize(672, 480); // ~21x15 tiles at 32px
    cam.setGridSize(40, 40);
    cam.update(20, 20);

    const vp = cam.getViewport();
    expect(vp.startX).toBeGreaterThanOrEqual(0);
    expect(vp.startY).toBeGreaterThanOrEqual(0);
    expect(vp.endX).toBeLessThanOrEqual(40);
    expect(vp.endY).toBeLessThanOrEqual(40);
    expect(vp.endX - vp.startX).toBeGreaterThan(10);
  });

  it("clamps viewport at grid edges", () => {
    const cam = new Camera();
    cam.setCanvasSize(672, 480);
    cam.setGridSize(40, 40);

    cam.update(0, 0);
    const vp = cam.getViewport();
    expect(vp.startX).toBe(0);
    expect(vp.startY).toBe(0);
  });

  it("clamps viewport at bottom-right edge", () => {
    const cam = new Camera();
    cam.setCanvasSize(672, 480);
    cam.setGridSize(40, 40);

    cam.update(39, 39);
    const vp = cam.getViewport();
    expect(vp.endX).toBeLessThanOrEqual(40);
    expect(vp.endY).toBeLessThanOrEqual(40);
  });

  it("returns tile size of 32", () => {
    const cam = new Camera();
    expect(cam.getTileSize()).toBe(32);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd client && pnpm exec vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add client/package.json client/test/fog.test.ts client/test/camera.test.ts
git commit -m "test: add unit tests for FogManager and Camera"
```
