# Canvas 2D Client Design Spec

> **Goal:** Replace the minimal ChatRoom client with a playable Canvas 2D game client that connects to the GameRoom, renders the world with fog of war, and lets players control their agent via keyboard.

**Architecture:** Thin Client. All game state comes from the server via Colyseus schema sync and messages. No client-side prediction. The client only renders and sends commands.

**Tech:** Vite + TypeScript + Canvas 2D + @colyseus/sdk + DOM overlays for HUD/modals.

---

## Module Architecture

Six source files under `client/src/`, each with a single responsibility:

```
main.ts          — entry point, wires all modules together
network.ts       — Colyseus connection, state listener, message handler
fog.ts           — three-tier fog of war state management
renderer.ts      — Canvas 2D rendering (grid, entities, fog overlay)
input.ts         — keyboard event handling → ActionCommand generation
camera.ts        — viewport calculation (player-centered)
types.ts         — client-side type definitions
```

### Data Flow

```
Server schema change ──→ network.ts (onStateChange)
                              │
                              ├──→ fog.ts (vision message → update fog map)
                              │
                              └──→ renderer.ts reads each frame:
                                    • network state (agents, settlements, tiles)
                                    • fog.getLevel(x,y) for rendering decisions
                                    • camera.getViewport() for visible tile range
                                    • player agent position for HUD

Keyboard event ──→ input.ts ──→ network.send(cmd)
```

### Design Decisions

- **renderer uses requestAnimationFrame**, decoupled from server tick rate. Even though state updates once per second, the canvas redraws at 60fps for smooth fog transitions and future animation support.
- **fog.ts is pure logic** — no DOM or Canvas access. It receives vision data, maintains a `Map<string, FogEntry>`, and exposes a `getLevel(x, y)` query.
- **network.ts exposes a readonly interface** — other modules never touch Colyseus schemas directly.

---

## Rendering

### Visual Style: Outlined Grid + Patterns

Grid lines visible at all zoom levels. Terrain has subtle patterns layered over base colors. Agents are simple geometric shapes with faction-colored outlines.

### Tile Rendering

| Terrain  | Base Color    | Pattern                        |
|----------|---------------|--------------------------------|
| plains   | `#3a6a3e`     | none                           |
| forest   | `#1a4a1a`     | small circles (tree canopy)    |
| mountain | `#7a6a5a`     | triangle peaks                 |
| water    | `#1a4a7a`     | wavy line                      |
| road     | `#b8a87a`     | dashed center line             |

Resource yield tiles show a small dot in the corner (green for food, brown for material).

Grid lines: `rgba(255,255,255,0.08)`, 1px.

### Entity Rendering

| Entity            | Shape                   | Color            |
|-------------------|-------------------------|------------------|
| Player            | diamond                 | `#4af` + white stroke |
| Same-faction agent| triangle                | `#6c6` + darker stroke |
| Enemy agent       | triangle                | `#c44`           |
| Merchant          | circle                  | `#da3`           |
| Village           | outlined square + fill  | `#d4a037`        |
| Den               | outlined square + fill  | `#8a4a8a`        |
| Structure         | small square (4px)      | inside settlement tile |
| Dead agent        | original shape, 50% alpha + X mark | |

### Three-Tier Fog of War

| Level    | Rendering                                                              |
|----------|------------------------------------------------------------------------|
| visible  | full render, normal colors                                             |
| explored | `rgba(0,0,0,0.5)` overlay; terrain and structures visible; entities shown at last known position using faction-based colors only (no player/NPC diamond distinction — all agents render as triangles in fog, merchants as circles) |
| unknown  | `rgba(0,0,0,0.9)` overlay; nearly black                               |

### Tile Size and Viewport

- **Tile size:** 32×32 pixels
- **Viewport:** dynamically calculated from canvas dimensions, approximately 21×15 tiles at default size
- **Camera:** player agent always centered in viewport; map scrolls around them

### HUD (DOM overlay, not Canvas)

- **Top-left:** HP bar (red/green) with numeric value
- **Below HP:** inventory as three icons with numbers: 🍖5 🪵3 💰0
- **Bottom-center:** key hint bar: `WASD:Move  E:Interact  Q:Attack  G:Gather  T:Deposit`

HUD uses DOM elements positioned over the canvas via CSS `position: absolute`. This avoids re-rendering HUD in the Canvas draw loop and makes text rendering trivial.

---

## Input System

### Key Bindings

| Key     | Action  | Command Sent                                       |
|---------|---------|----------------------------------------------------|
| W / ↑   | move up    | `{ type: "move", target: { x, y-1 } }`         |
| A / ←   | move left  | `{ type: "move", target: { x-1, y } }`         |
| S / ↓   | move down  | `{ type: "move", target: { x, y+1 } }`         |
| D / →   | move right | `{ type: "move", target: { x+1, y } }`         |
| E       | interact   | context-dependent (see below)                   |
| Q       | attack     | `{ type: "attack", targetId }` nearest adjacent enemy |
| G       | gather     | `{ type: "gather", resourceTile: currentPos }`  |
| T       | deposit    | `{ type: "deposit", settlementId }` at current settlement |

### Adjacency

Adjacent means Manhattan distance 1 (up/down/left/right, no diagonals), consistent with server-side movement and combat rules.

### E Key Interaction Priority

When E is pressed, check adjacent tiles (Manhattan distance 1) in order:

1. Adjacent merchant → open trade modal
2. Adjacent same-faction NPC → open dialogue modal
3. Standing on a settlement tile (check `tiles.get("x,y").ownerFaction` matches player faction, then find settlement by matching faction) → `{ type: "take", settlementId, resource: "food", amount: 1 }`
4. Nothing → no action

### Q Key Target Selection

Find the nearest adjacent (Manhattan distance 1) enemy agent (different faction, alive). If multiple adjacent enemies exist, pick any one (non-deterministic is fine; server validates the command regardless).

### Trade Modal

Minimal DOM modal triggered by E near a merchant. Merchants carry currency and buy resources from the village. Shows exchange rate: `MERCHANT_TRADE_RATE` resources per 1 currency. Two buttons:

- **Sell Food:** `{ type: "trade", targetId: merchantId, offer: "food", offerAmount: MERCHANT_TRADE_RATE, want: "currency", wantAmount: 1 }`
- **Sell Material:** `{ type: "trade", targetId: merchantId, offer: "material", offerAmount: MERCHANT_TRADE_RATE, want: "currency", wantAmount: 1 }`

Closes on Escape or after sending the command.

### Dialogue Modal

Triggered by E near a talkable NPC. The dialogue system is server-side (pre-written RPG-style trees). For MVP, the client sends `{ type: "talk", targetId, optionId: "greet" }` as a fixed greeting. Full dialogue tree UI (where the server sends options and the client displays them) is deferred to a follow-up spec — the server's dialogue engine exists but there is no message protocol for sending dialogue options to the client yet.

### Throttling

WASD movement throttled to one command per 200ms. Reason: server processes one command per tick (1s), and `setPlan([cmd])` overwrites the current plan. Rapid input would waste commands. Other keys are not throttled.

---

## Network Layer

### Connection Flow

```
1. Create Colyseus Client (ws://localhost:2567 or wss:// for HTTPS)
2. client.joinOrCreate("game", { name })
3. Receive initial room.state (WorldStateSchema)
4. Register listeners:
   - room.state.listen("tick") → trigger re-render
   - room.onMessage("joined") → store agentId (see Agent ID Discovery below)
   - room.onMessage("vision") → update fog manager
   - room.onMessage("death") → show death screen
5. Input events → room.send("command", actionCommand)
```

### Agent ID Discovery

**Server change required:** GameRoom.onJoin must send a `"joined"` message to the connecting client with their assigned agent ID:

```typescript
client.send("joined", { agentId: id });
```

The client stores this as `playerId` in the NetworkClient. This is needed for:
- Centering the camera on the player's agent
- Rendering the player as a diamond (vs triangle for other agents)
- Reading the player's position for movement commands
- Displaying the player's HP and inventory in the HUD

### network.ts Public Interface

```typescript
interface NetworkClient {
  readonly state: WorldStateSchema | null;
  readonly playerId: string | null;
  connect(name: string): Promise<void>;
  send(cmd: ActionCommand): void;
  onVision(cb: (data: VisionData) => void): void;
  onDeath(cb: (agentId: string) => void): void;
  disconnect(): void;
}
```

All other modules interact with the network through this interface. No direct Colyseus SDK usage outside `network.ts`.

### Protocol Derivation

WebSocket protocol (`ws://` vs `wss://`) is derived from `window.location.protocol`, consistent with the existing client implementation.

---

## Fog Manager

### State Structure

```typescript
type FogLevel = "visible" | "explored" | "unknown";

interface FogEntry {
  level: FogLevel;
  terrain: TerrainType;
  lastEntities: EntitySnapshot[];
  timestamp: number;        // tick when last observed
}

// Internal storage: Map<string, FogEntry> keyed as "x,y"
```

### Update Logic

The server's vision message contains the agent's **entire MapMemory** (all tiles ever observed, not just current vision). Each tile has a `timestamp` indicating when it was last seen. The fog manager uses `timestamp === currentTick` to distinguish currently visible tiles from previously explored ones.

On receiving a `"vision"` message with tick `T`:

1. For each tile in the vision data:
   - If `tile.timestamp === T` → set level to `visible`, update terrain/entities
   - If `tile.timestamp < T` → set level to `explored`, update terrain/entities (last known)
2. Tiles not present in vision data → remain `unknown`

This means the fog manager does not need to track "was visible last tick" — the server's timestamps are the source of truth.

### Public Interface

```typescript
interface FogManager {
  update(vision: VisionData): void;
  getLevel(x: number, y: number): FogLevel;
  getEntry(x: number, y: number): FogEntry | undefined;
}
```

Renderer calls `getLevel()` each frame per visible tile to decide rendering.

---

## Camera

### Viewport Calculation

```typescript
interface Viewport {
  startX: number;  // first visible tile column
  startY: number;  // first visible tile row
  endX: number;    // last visible tile column (exclusive)
  endY: number;    // last visible tile row (exclusive)
  offsetX: number; // sub-tile pixel offset for smooth centering
  offsetY: number;
}
```

Camera centers on the player agent's tile. Viewport is clamped to grid bounds (0..width, 0..height) so edges don't show void.

### Update

Called each frame with player position. Computes which tiles are visible and the pixel offset for rendering.

---

## Game Loop and Lifecycle

### States

```
CONNECTING → PLAYING → DEAD
                ↓
            (disconnect) → CONNECTING
```

### CONNECTING

Show a simple "Connecting..." screen. On success (receiving `"joined"` message), transition to PLAYING. On failure (connection refused, village full, timeout), show error text and a "Retry" button that attempts reconnection.

### PLAYING

```
requestAnimationFrame loop:
  1. input.poll()  — process queued key events, send commands
  2. camera.update(playerAgent.x, playerAgent.y)
  3. renderer.draw(state, fog, camera)
```

HUD updates reactively when state changes (tick listener).

### DEAD

On `"death"` message:
- Stop processing input (ignore all keys except a "rejoin" button)
- Show "You Died" overlay with a "Rejoin" button
- Rejoin creates a new connection

---

## File Changes Summary

### New Files
- `client/src/main.ts` — rewrite (replace ChatRoom client)
- `client/src/network.ts`
- `client/src/fog.ts`
- `client/src/renderer.ts`
- `client/src/input.ts`
- `client/src/camera.ts`
- `client/src/types.ts`

### Modified Files
- `client/index.html` — replace with canvas + HUD DOM structure

### Server Changes (minimal)
- `server/src/rooms/GameRoom.ts` — add `client.send("joined", { agentId: id })` in `onJoin` after agent creation

---

## Out of Scope

- Client-side prediction / interpolation
- Anti-cheat
- Sound / music
- Responsive design / mobile
- Settings / key rebinding
- Minimap
- Chat system
- LLM integration (server handles this)
