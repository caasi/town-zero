# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

town-zero is a multiplayer real-time ecosystem simulation .io game with LLM-driven NPCs. Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction = defeat; cooperation possible but betrayal allowed. The long-term goal is to use this as a testbed for civilian C4ISR systems.

## Tech Stack

- **Monorepo:** pnpm workspaces (`shared/`, `server/`, `client/`)
- **Package Manager:** pnpm
- **Server Runtime:** Node.js via tsx (Colyseus requires Node HTTP compatibility)
- **Server:** Colyseus 0.17.x + @colyseus/schema 4.x
- **Client:** @colyseus/sdk + Vite
- **Testing:** Vitest
- **Language:** TypeScript (strict, ES2022)

## Commands

```bash
# Install all workspace dependencies
pnpm install

# Build shared types + server
pnpm run build

# Run server (dev mode with hot reload, port 2567)
pnpm run dev:server

# Run client (Vite dev server, port 3000)
pnpm run dev:client

# Run server tests
pnpm run test
```

## Architecture

**Settlement-centric model:** Villages and monster dens are the same `Settlement` abstraction with different parameters. Both have population, inventory, structures (housing + production), and territory.

**Unified InputFrame:** All entities (players, LLM-driven NPCs, bots) produce the same `InputFrame` type (`{ seq, direction?, action? }`). The simulation loop does not distinguish command sources. This enables seamless player disconnect → bot takeover → reconnect. All actions are instant (1 tick) — no multi-tick FSM states. FSMState is reduced to `"idle" | "dead"`.

**Simulation flow (per tick at 8 ticks/s = 125ms):**
1. Consume one InputFrame per alive agent from `inputQueue` (player) or `planBacklog` (bot/LLM); execute via `executeFrame` (direction → turn-before-move, action → instant effect)
2. Bot controller decides for idle bot agents → fills `planBacklog` with `InputFrame[]`
3. Production facilities convert raw materials → food/material (counter-gated, ~10s)
4. Agents consume food from personal inventory (counter-gated, ~30s)
5. Merchant spawning and movement (counter-gated, ~120s)
6. Vision update (MapMemory per agent)
7. Memory merge between adjacent same-faction agents

**Information model:** No global omniscience. Each agent has a personal `MapMemory` (sparse grid of observed tiles with timestamps). Agents must be adjacent to exchange information. This creates natural fog of war and makes scouts strategically important.

**LLM integration:** Natural language prompt in (agent state + MapMemory) → structured JSON FrameAction array out → wrapped as `InputFrame[]` in `planBacklog`. Haiku-tier model, 10-30s intervals, skipped when agent is busy. Dialogue system uses pre-written RPG-style trees; LLM only decides y/n on player requests.

## Key Design Documents

- **Spec:** `docs/superpowers/specs/2026-04-01-town-zero-mvp-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-01-town-zero-mvp.md` (19 tasks, TDD, full code)
- **References:** `docs/references.md` — prior art and industry resources for design decisions. Review and update when introducing new patterns or making significant architectural changes.

## Development Notes

- Colyseus schemas use `schema()` function API (not `@type()` decorator, not `defineTypes()`) — @colyseus/schema v4 recommended approach
- `server/src/polyfill.ts` provides `Symbol.metadata` — V8 hasn't implemented it yet, @colyseus/schema v4 needs it; imported as first line in `server/src/index.ts`
- Use `@colyseus/core` directly, not the `colyseus` meta-package — the meta-package pulls in many sub-packages that cause duplicate `@colyseus/core` instances
- Server simulation is authoritative; client only renders and sends commands
- **Per-tick InputFrame (Gambetta reconciliation):** Client sends `input` messages (`InputFrame { seq, direction?, action? }`) every 125ms while a movement key is held, and once per action key press. Server consumes one from `agent.inputQueue` per tick via `executeFrame`, advancing `agent.lastProcessedInput`. Client reconciles by accepting server position as baseline, pruning acknowledged inputs, and replaying direction-only frames. `input:stop` with seq flushes server queue and client pending buffer. Player frames (`seq > 0`) flush bot `planBacklog`
- **Seq invariants:** `isValidInputFrame` requires `Number.isSafeInteger(seq) && seq >= 0`. GameRoom ingress rejects `seq < 1` from clients (seq=0 reserved for bot/planBacklog). `Agent.enqueueInput` rejects `seq <= lastProcessedInput` (stale) and `seq <= lastQueued` (duplicate). `lastProcessedInput` only advances via `Math.max`
- **Multi-key movement:** Input uses delete+re-add on keydown so Set iteration order reflects recency. `update()` picks the most recently pressed movement key (last in Set). This gives immediate direction switching when pressing a new key while holding another
- MVP fog of war is client-side only (trusts client, no anti-cheat). Even so, client code must treat unknown tiles as truly unknown — prediction reads from fog snapshots (`fog.tileSource()`), never raw `state.tiles`
- Player agents use `role: "player"` — `role` is a functional type tag (`"merchant"`, `"scout"`, etc.), not a display name
- Client modules: `network.ts` (Colyseus connection), `renderer.ts` (Canvas 2D), `camera.ts` (viewport), `fog.ts` (fog of war), `input.ts` (WASD + action keys), `display.ts` (movement prediction + lerp), `main.ts` (game loop + HUD)
- `NetworkClient.connect()` has a 10s join timeout with full cleanup on expiry, a concurrent-call guard (`isConnecting` in main.ts), and `disconnect()` rejects any in-flight join promise
- Colyseus Client constructor uses `http://`/`https://` scheme (not `ws://`/`wss://`) — SDK handles WebSocket upgrade internally
- `SimulationState` includes `nextMerchantId` to avoid module-level mutable state
- Food consumption is from agent personal inventory, not settlement (agents must `take` from settlement)
- Server runs on Node.js via tsx
- Use pnpm, not bun — bun duplicates @colyseus/core instances causing matchmaker state isolation
- Shared logic between server and client (e.g. `tilesInManhattanRadius` for vision shape) must live in `@town-zero/shared` — duplicating geometry/distance logic across packages causes shape mismatches
- Client-side movement prediction (`display.ts`): `DisplayState` tracks predicted tile positions (`displayX/Y`) and lerped pixel positions (`renderX/Y`). `reconcileFromServer` accepts server state as baseline, prunes acknowledged `InputFrame[]` by seq, replays direction-only frames (skips action frames). `updateRender(dt)` lerps pixel positions toward display positions
- Input uses held-key tracking (`keydown`/`keyup` Set) for local prediction and sends per-tick `input` messages (InputFrame with seq + direction) from `update()` while keys are held — not `keydown` repeat events (OS repeat has variable initial delay and rate). Action keys (Q/E/T) send InputFrame with seq + action immediately on keydown
- Fog memory uses a snapshot model (`TileSnapshot` = terrain + entities + timestamp). Fog level is derived: `predictedVisible` → visible, has snapshot → explored, else → unknown. No `level` field stored — add new tile properties to `TileSnapshot` and they're automatically captured
- Unknown tiles render as eigengrau (`#16161d`), void outside map boundary renders as true black (`#000`)
- Dialogue system: `talk` action is processed through the tick pipeline via `executeFrame` → `startDialogue`. `dialogue:advance/choose/close` messages use the session-manager API directly. Dialogue lock: while `agent.talkingToNpcId` is set, all input is rejected (even if the active session was already cleaned up). Timeout is detected in `tickDialogues()` called from the tick loop. Client enters `dialogueMode` which intercepts W/S/E/Esc for dialogue navigation
- `DialogueBuilderApi.entry()` adds conditional entry points to dialogue trees. `entryPoints` are evaluated in `startDialogue()` against NPC beliefs to select the starting node
- **Turn-before-move:** `executeFrame` for direction input only updates `agent.facing` when the intended direction differs from current facing (no position change). A second input in the same direction actually moves. Client `DisplayState.predictMove` mirrors this logic. Interact (KeyE) checks only the tile directly in front of the player (predicted facing), not any adjacent tile
- **Facing-based interaction:** KeyE sends a single `{ type: "interact" }` frame. Server-side `dispatchInteract` resolves the agent's facing tile against a 6-rule priority (merchant modal client-side; dialogue-entry-matching agent → talk; hostile agent → attack; same-faction no-entry → noop; resource tile → gather; else noop). Attack is facing-only for all callers including LLM plans. KeyQ is not bound.
- **NPC bubble channel:** NPCs expose a one-way bubble channel via `Agent.setBubble(text, durationTicks, currentTick)` and a synced `bubbleText` field on `AgentSchema` (empty string = no bubble). In v1 the only wired source is `proximityBubble` (per-NPC config with duration + cooldown and a per-player ledger); `startDialogue` clears the bubble; `onLeave` purges the disconnecting player's ledger entries so reconnect re-fires greetings. Rendering is client-side — text drawn above sprite in the existing visible-agent cull block; no client-side expiry.

## Known Debt

- `PRODUCTION_OUTPUT` constant comment says "food/material produced per cycle" but `processProduction` only converts material→food. Update comment or extend production to support material output when adding new production types.

## TODO

- [x] Create Colyseus schemas for WorldState, Agent, Settlement, Tile, Structure (use `schema()` API)
- [x] Create GameRoom that wraps SimulationState with tick loop (`setSimulationInterval`)
- [x] Sync simulation state → Colyseus schemas each tick
- [x] Handle player join/leave with Agent creation and bot takeover
- [x] Handle player commands via `onMessage`
- [x] Restore Canvas 2D client with renderer, input, fog of war, HUD
- [ ] Wire LLM scheduler into GameRoom tick
- [x] Add facing direction to Agent (needed for dialogue target selection and future combat/animation)
- [x] Add NPC dialogue system (session manager, Farmer Reed scenario, GameRoom integration, client UI)
- [ ] **Dialogue eDSL review:** `shared/package.json` subpath export points to `.ts` not `dist/`; `t()` missing `boolean` in type signature; add `not()` to `ExprBuilder`; add `DialogueTreeData.validate()` for build-time graph integrity checks (dangling refs, empty next, action cycles); deduplicate `toExpr()` helper across `expressions.ts` and `builders.ts`
- [ ] **Phase 8 trigger execution:** only `set_fact` supported (others warn); `effect.target` ignored (uses `rule.targets` instead); global omniscience in belief aggregation violates no-global-omniscience principle; add early-exit when no facts changed
- [ ] **Trigger registry wiring:** `setBelief()` and `mergeBeliefs()` don't call `recordChangedFact()` — triggers only fire from dialogue-session changes; `mergeBeliefs()` should return changed keys `Set<string>`; empty `extractFactKeys` deps means trigger never fires; `loadScenario()` doesn't assign `triggerRegistry` to `SimulationState`
- [ ] **TriggerRule type split:** `fired: boolean` mixes mutable execution state into data type; split into `TriggerRuleData` (immutable) + registry-managed `firedIds: Set<string>`
- [ ] **Tile object / prop system:** Tiles need an `objectType` layer separate from terrain (bush, box, tree). Currently bush uses a minimal `objectType` field on Tile; future iteration should extract a full TileObject concept with durability, loot tables, and interaction types. Settlement structures remain separate from wild tile objects.
