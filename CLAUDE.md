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

**Unified ActionCommand:** All entities (players, LLM-driven NPCs, bots) produce the same `ActionCommand` type. The simulation loop does not distinguish command sources. This enables seamless player disconnect → bot takeover → reconnect.

**Simulation flow (per tick at 1 tick/s):**
1. Process ongoing multi-tick actions (gathering, fighting)
2. Dequeue and execute next command from each agent's plan
3. Bot controller decides for idle bot agents
4. Production facilities convert raw materials → food/material
5. Agents consume food from personal inventory (starvation → HP loss → death)
6. Merchant spawning and movement
7. Vision update (MapMemory per agent)
8. Memory merge between adjacent same-faction agents

**Information model:** No global omniscience. Each agent has a personal `MapMemory` (sparse grid of observed tiles with timestamps). Agents must be adjacent to exchange information. This creates natural fog of war and makes scouts strategically important.

**LLM integration:** Natural language prompt in (agent state + MapMemory) → structured JSON ActionCommand array out. Haiku-tier model, 10-30s intervals, skipped when agent is busy. Dialogue system uses pre-written RPG-style trees; LLM only decides y/n on player requests.

## Key Design Documents

- **Spec:** `docs/superpowers/specs/2026-04-01-town-zero-mvp-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-01-town-zero-mvp.md` (19 tasks, TDD, full code)
- **References:** `docs/references.md` — prior art and industry resources for design decisions. Review and update when introducing new patterns or making significant architectural changes.

## Development Notes

- Colyseus schemas use `schema()` function API (not `@type()` decorator, not `defineTypes()`) — @colyseus/schema v4 recommended approach
- `server/src/polyfill.ts` provides `Symbol.metadata` — V8 hasn't implemented it yet, @colyseus/schema v4 needs it; imported as first line in `server/src/index.ts`
- Use `@colyseus/core` directly, not the `colyseus` meta-package — the meta-package pulls in many sub-packages that cause duplicate `@colyseus/core` instances
- Server simulation is authoritative; client only renders and sends commands
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
- Client-side movement prediction (`display.ts`): `DisplayState` tracks predicted tile positions (`displayX/Y`) and lerped pixel positions (`renderX/Y`). `syncFromServer` only overrides local player when server position actually changes (via `lastServerPos` tracking) to preserve predictions between server ticks
- Input uses held-key tracking (`keydown`/`keyup` Set + `update()` polling from game loop), not `keydown` repeat events — OS repeat has variable initial delay and rate
- Fog memory uses a snapshot model (`TileSnapshot` = terrain + entities + timestamp). Fog level is derived: `predictedVisible` → visible, has snapshot → explored, else → unknown. No `level` field stored — add new tile properties to `TileSnapshot` and they're automatically captured
- Unknown tiles render as eigengrau (`#16161d`), void outside map boundary renders as true black (`#000`)

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
- [ ] Add facing direction to Agent (needed for dialogue target selection and future combat/animation)
- [ ] **Dialogue eDSL review:** `shared/package.json` subpath export points to `.ts` not `dist/`; `t()` missing `boolean` in type signature; add `not()` to `ExprBuilder`; add `DialogueTreeData.validate()` for build-time graph integrity checks (dangling refs, empty next, action cycles); deduplicate `toExpr()` helper across `expressions.ts` and `builders.ts`
- [ ] **Phase 8 trigger execution:** only `set_fact` supported (others warn); `effect.target` ignored (uses `rule.targets` instead); global omniscience in belief aggregation violates no-global-omniscience principle; add early-exit when no facts changed
- [ ] **Trigger registry wiring:** `setBelief()` and `mergeBeliefs()` don't call `recordChangedFact()` — triggers only fire from dialogue-session changes; `mergeBeliefs()` should return changed keys `Set<string>`; empty `extractFactKeys` deps means trigger never fires; `loadScenario()` doesn't assign `triggerRegistry` to `SimulationState`
- [ ] **TriggerRule type split:** `fired: boolean` mixes mutable execution state into data type; split into `TriggerRuleData` (immutable) + registry-managed `firedIds: Set<string>`
- [ ] **Tile object / prop system:** Tiles need an `objectType` layer separate from terrain (bush, box, tree). Currently bush uses a minimal `objectType` field on Tile; future iteration should extract a full TileObject concept with durability, loot tables, and interaction types. Settlement structures remain separate from wild tile objects.
