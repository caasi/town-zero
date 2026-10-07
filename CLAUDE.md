# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

town-zero is a multiplayer real-time ecosystem simulation .io game with AI-driven NPCs (code-built option menus, decisions by the Jev model). Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction is defeat; cooperation is possible but betrayal is allowed. The long-term goal is to use this as a testbed for civilian C4ISR (command, control, communications, computers, intelligence, surveillance and reconnaissance) systems.

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

# Run server + client tests (skips the slow property tests)
pnpm run test

# Run the fast-check property tests (*.property.test.ts); CI runs both
pnpm run test:props

# Type-check src and test files (server, client) and the script DSL type tests.
# Vitest strips types, so a test can stop matching the code it tests without
# this. Needs shared built first (pnpm run build). Run it before committing.
pnpm run typecheck

# Only the type-level tests for the script DSL
pnpm run typecheck:types
```

## Architecture

**Settlement-centric model:** Villages and monster dens are the same `Settlement` abstraction with different parameters. Both have population, inventory, structures (core + housing), and territory.

**Unified InputFrame:** All entities (players, AI NPCs, bots) produce the same `InputFrame` type (`{ seq, direction?, action? }`). The simulation loop does not distinguish command sources. All actions are instant (1 tick) — no multi-tick FSM states. FSMState is reduced to `"idle" | "dead"`.

**Simulation flow (per tick at 8 ticks/s = 125ms):**
0. Before the tick, `GameRoom` calls `JevController.update` → one frame into `planBacklog` of each `"llm"` agent (see below)
1. Consume one InputFrame per alive agent from `inputQueue` (player) or `planBacklog` (bot/AI NPC); execute via `executeFrame` (direction → turn-before-move, action → instant effect)
2. Bot controller decides for idle bot agents → fills `planBacklog` with `InputFrame[]`
3. Agents consume food from personal inventory (counter-gated, ~30s); resource tiles grow back one unit every `RESOURCE_REGROW_TICKS`, also while Jev is paused
4. Vision update (MapMemory per agent), then bubble expiry and NPC event dispatch; dead members leave `populationIds` (a dead player keeps its slot until it leaves)
5. Memory merge between adjacent same-faction agents

Source of truth: `processTick` in `server/src/simulation/tick.ts`.

**Information model:** No global omniscience. Each agent has a personal `MapMemory` (sparse grid of observed tiles with timestamps). Agents must be adjacent to exchange information. This creates natural fog of war and makes scouts strategically important.

**AI NPC decisions (Jev, spec 003, which has the option table).** "Code lists the options, Jev picks one, code acts." `server/src/ai/jev-controller.ts` drives every alive `controller: "llm"` agent (now: the den beasts). `server/src/ai/jev.ts` asks a TypeSafe AI `choice` question, and `nextFrame` turns the picked goal into one `InputFrame` per tick. Rules:
- Offer only options that yield at least one frame. Otherwise the agent asks again at once (at most one call per 8 ticks per agent, one call in flight).
- State and options are words, never coordinates: Jev is weak at spatial and numeric reasoning.
- Keep `rest` first: Jev prefers the first option.
- Offer `attack` only for threats (an enemy near the den, or next to the beast), so beasts guard the den instead of hunting.
- Beasts take one step or turn per 2 ticks (`MOVE_INTERVAL_TICKS`), so players can outrun them.
- State and options use only what the beast knows: enemies as it saw them this tick (`EntitySnapshot` keeps role and HP), and the den food from its `food:<settlement id>` belief (updated inside a settlement, shared with adjacent agents of the same faction).
- Without `TYPESAFE_API_KEY`, or when a call fails, a fallback rule decides.
- Jev calls cost money. `GameRoom` makes no `JevController.update` while no player is active: a player is active while its tab is visible (`presence { active }` on `visibilitychange`) and it sent a message (`input`, `dialogue:*`, `revive`, `rename`, or `presence { active: true }`) in the last `IDLE_TIMEOUT_TICKS` (~2 min). `processTick` still runs, but paused beasts do not get hungry (`processTick(state, { llmPaused })`).
- The log lines (`[jev] … chose …`, `[idle]`, `[presence]`) and how to count the Jev cost from them are in `deploy/README.md`, "Costs and limits".

**NPC replies (spec 004).** No model writes dialogue text: dialogue is pre-written trees. A `reply` node holds written lines with a description each; `ReplyController` (`server/src/ai/reply-controller.ts`, driven by `GameRoom` each tick) asks Jev to pick one from the NPC profile (`gender`, `personality`, farewells in `s.npc()`), its beliefs, what the player said and the village storehouse.
- The first line is the fallback and cannot have a condition. While Jev thinks, the client shows "…" and advance and choose do nothing.
- A pick is cached by everything Jev saw (NPC, node, state words, lines); a new state asks again. A near tie is cached after one sample until the server restarts.
- A line follows the state only when another line fits the same personality in another situation (spec 004, real runs): check new personalities and line wording with real calls. The story the lines draw from is `docs/story.md`.

## Key Design Documents

- **Specs / plans:** `docs/superpowers/specs/` and `docs/superpowers/plans/`. The MVP is `2026-04-01-town-zero-mvp*`. New pairs use a 3-digit prefix (`001-combat-as-interaction`, `002-event-system`); continue from the highest number. The older date-prefixed files stay as they are.
- **TODO:** `TODO.md` — open items in priority order, unranked items, recent done items.
- **Changelog:** `CHANGELOG.md`, grouped by date (each push to `main` is deployed). When you merge a change that players or contributors can see, add an entry under the date of the merge.
- **References:** `docs/references.md` — prior art and industry resources for design decisions. Review and update when introducing new patterns or making significant architectural changes.

## Development Notes

- Colyseus schemas use `schema()` function API (not `@type()` decorator, not `defineTypes()`) — @colyseus/schema v4 recommended approach
- `server/src/polyfill.ts` provides `Symbol.metadata` — V8 hasn't implemented it yet, @colyseus/schema v4 needs it; imported as first line in `server/src/index.ts`. `server/src/encoder-config.ts` comes second: it raises `Encoder.BUFFER_SIZE` to 128 KB (the 40×40 grid does not fit the 8 KB default) and must run before any schema code, so do not reorder these two imports
- Use `@colyseus/core` directly, not the `colyseus` meta-package — the meta-package pulls in many sub-packages that cause duplicate `@colyseus/core` instances
- Server simulation is authoritative; client only renders and sends commands
- **Per-tick InputFrame (Gambetta reconciliation):** Client sends `input` messages (`InputFrame { seq, direction?, action? }`) every 125ms while a movement key is held, and once per action key press. Server consumes one from `agent.inputQueue` per tick via `executeFrame`, advancing `agent.lastProcessedInput`. Client reconciles by accepting server position as baseline, pruning acknowledged inputs, and replaying direction-only frames. On key release the client just stops sending: the server runs every frame it received and the client keeps unacknowledged frames until `lastProcessedInput` covers them (flushing on release pulled the player back one step). `input:stop` is a no-op handler kept only so tabs from older builds are not disconnected (Colyseus kicks clients that send an unregistered type). Player frames (`seq > 0`) flush bot `planBacklog`
- **Seq invariants:** `isValidInputFrame` requires `Number.isSafeInteger(seq) && seq >= 0`. GameRoom ingress rejects `seq < 1` from clients (seq=0 reserved for bot/planBacklog). `Agent.enqueueInput` rejects `seq <= lastProcessedInput` (stale) and `seq <= lastQueued` (duplicate). `lastProcessedInput` only advances via `Math.max`
- **Multi-key movement:** Input uses delete+re-add on keydown so Set iteration order reflects recency. `update()` picks the most recently pressed movement key (last in Set). This gives immediate direction switching when pressing a new key while holding another
- MVP fog of war is client-side only (trusts client, no anti-cheat). Even so, client code must treat unknown tiles as truly unknown — prediction reads from fog snapshots (`fog.tileSource()`), never raw `state.tiles`
- **Player names:** the rules live in `@town-zero/shared` (`normalizePlayerName` in `player-name.ts`; the limits `PLAYER_NAME_MAX`, `PLAYER_NAME_MAX_MARKS` and `PLAYER_NAME_MAX_UNITS` in `constants.ts`), so the client and the server clean a name the same way: control characters and letters that draw as nothing (Hangul fillers, blank Braille) become spaces, format characters are removed except ZWJ (zero-width joiner, which joins emoji; bidi overrides and zero-width spaces could reverse text or hide a name), white space folds, at most 16 characters as a person sees them (grapheme clusters), at most 3 combining marks per character (Zalgo text), at most 128 UTF-16 units, and something visible must remain. The client keeps the name in localStorage (`client/src/player-name.ts`; a random adjective-and-animal name on a first visit), sends it on join and sends `rename { name }` from the HUD; the server cleans it again (client input is untrusted), sets `Agent.name` and syncs `AgentSchema.name`. A player's color is `playerColor(name)` (an FNV-1a hash, a small fixed string hash, into a 6-color palette), the same on every client, also for yourself, so players can name each other by color; you are a diamond filled with your color and edged white, the others are filled white and edged with their color (also in the fog; the player list shows each color as a plain swatch). No two agents share a name, players or NPCs (`playerNameKey`: NFKC Unicode normalization and lower case): the server refuses a rename to a taken name with `rename:rejected`, and gives a join with a taken name the first free number ("Quiet Otter 2"; two tabs of one browser send the same stored name). The client saves a rename to localStorage only after the server took it. Names go into the DOM by `textContent` only
- Player agents use `role: "player"` — `role` is a functional type tag (`"beast"`, `"scout"`, etc.), not a display name
- Client modules: `network.ts` (Colyseus connection), `renderer.ts` (Canvas 2D), `camera.ts` (viewport), `fog.ts` (fog of war), `input.ts` (WASD + action keys), `display.ts` (movement prediction + lerp), `dialogue-ui.ts` (dialogue panel), `player-name.ts` (name in localStorage), `leave-message.ts` (error-screen text), `version.ts` (stale-client check), `main.ts` (game loop + HUD)
- **Reconnection is off on both sides.** The server removes a player in `onLeave` and never calls `allowReconnection`, so the client sets `room.reconnection.enabled = false` (the 0.17 SDK otherwise retries 15 times over ~56 s and the screen freezes). `room.onLeave` shows the error overlay with Retry. To support reconnection, add `onDrop` + `allowReconnection` on the server first, then turn the client option back on
- **Join refusal codes:** `GameRoom.onJoin` refuses with `JOIN_REFUSED_FULL` / `JOIN_REFUSED_NO_VILLAGE` (4101 / 4100, `shared/src/constants.ts`), and the client turns them into text (`client/src/leave-message.ts`). Never use 4000 or 4001 for a game reason: Colyseus sends 4000 (CONSENTED) and 4001 (SERVER_SHUTDOWN, on every deploy). A refusal in `onJoin` reaches the client as a failed join with `err.code`, not as a leave
- Assign room state with `this.state = new WorldStateSchema()`: `setState` is deprecated in 0.17
- **Schema sync must not rebuild unchanged children.** Replacing schema instances every tick (e.g. `ArraySchema.clear()` + `push(new ...)`) re-sends them in every patch; `syncSettlement` rebuilds `structures` only when the id list changes (222 → 2 bytes per idle tick)
- `NetworkClient.connect()` has a 10s join timeout with full cleanup on expiry, a concurrent-call guard (`isConnecting` in main.ts), and `disconnect()` rejects any in-flight join promise
- Colyseus Client constructor uses `http://`/`https://` scheme (not `ws://`/`wss://`) — SDK handles WebSocket upgrade internally
- Food consumption is from agent personal inventory, not settlement (agents must `take` from settlement)
- **Resource tiles run out and grow back.** A resource tile holds up to `RESOURCE_MAX_AMOUNT` units; `gather` takes one, and every tile grows back one unit per `RESOURCE_REGROW_TICKS` (both in `shared/src/constants.ts`). `TileMemory.resourceAmount` keeps what an agent saw, so a beast walks to a food place it remembers as having food and finds out it is empty when the place comes into sight. A used-up tile is synced with `resourceYield: ""`, so the client shows it as empty with no client change; `syncToSchema` assigns that field only when it changes
- Server runs on Node.js via tsx
- Use pnpm, not bun — bun duplicates @colyseus/core instances causing matchmaker state isolation
- Shared logic between server and client (e.g. `tilesInManhattanRadius` for vision shape, `isMoveBlocked` for movement) must live in `@town-zero/shared` — duplicating geometry/distance logic across packages causes shape mismatches
- Client-side movement prediction (`display.ts`): `DisplayState` tracks predicted tile positions (`displayX/Y`) and lerped pixel positions (`renderX/Y`). `reconcileFromServer` accepts server state as baseline, prunes acknowledged `InputFrame[]` by seq, replays direction-only frames (skips action frames). `updateRender(dt)` lerps pixel positions toward display positions
- Input uses held-key tracking (`keydown`/`keyup` Set) for local prediction and sends per-tick `input` messages (InputFrame with seq + direction) from `update()` while keys are held — not `keydown` repeat events (OS repeat has variable initial delay and rate). Action keys (E/T) send InputFrame with seq + action immediately on keydown
- Fog memory uses a snapshot model (`TileSnapshot` = terrain + entities + timestamp). Fog level is derived: `predictedVisible` → visible, has snapshot → explored, else → unknown. No `level` field stored — add new tile properties to `TileSnapshot` and they're automatically captured
- **Player lifecycle:** a player who leaves is removed (agent and `populationIds`); a new join always creates a new agent. A dead player keeps its session and its population slot, and death ends its dialogue; after `REVIVE_DELAY_TICKS` (~5s, checked on the server) the client's `Revive` button sends `revive`, and the same agent comes back in a free village tile with full HP, its inventory and its MapMemory. Dead NPCs come back on their own (`processRespawns`, called by `GameRoom` after each tick): village NPCs after ~30s; den beasts after ~30s when the den pays food, free when no beast of the den is alive
- **Property tests (fast-check):** files named `*.property.test.ts` (server only). `pnpm run test` skips them; `pnpm run test:props` runs only them; CI runs both. They guard timing and protocol invariants: input frames are run or acknowledged (`test/rooms/input-ack.property.test.ts`, model-based over the GameRoom harness in `room-harness.ts`), every offered beast option yields a frame (`test/ai/options.property.test.ts`), and Jev replies in any order keep one call in flight, asks 8 ticks apart and no goal for the dead (`test/ai/jev-timing.property.test.ts`, `fc.scheduler`). Player name cleaning keeps its rules for any string (`test/shared/player-name.property.test.ts`; the same checks run on the Big List of Naughty Strings in `player-name-naughty.test.ts`). When you add one, break the guarded code once and check that the property fails
- Tests never call the real Jev API: `server/vitest.config.ts` clears `TYPESAFE_API_KEY`. To run the server with Jev, export `TYPESAFE_API_KEY` before `pnpm run dev:server`
- The HUD shows the build commit (`#commit` in `client/index.html`, Vite `%VITE_COMMIT%`). CI passes `github.sha` as the `VITE_COMMIT` Docker build arg; `client/vite.config.ts` shortens it to 7 characters and uses `dev` when it is not set
- **Stale-client hint:** the Dockerfile also gives the commit to the server (`TOWN_ZERO_COMMIT`, full SHA), and `joined` carries it. When the client's short commit is not a prefix of it, or `joined` has no commit (a rollback to an older server), the client shows `#update-notice` (inside the always-rendered `role="status"` region `#update-banner`) with `Reload`, and `Retry` on the error screen reloads the page instead of reconnecting. After a deploy the player presses `Retry` (a reconnect, so a restarting container gives the in-game error, not an nginx 502); when that join finds another build, the page reloads at once. Only a `Retry` join reloads by itself, so a cached old page cannot reload forever. A dev client never shows it. `main.ts` has no tests; check this flow by hand. A deploy restarts the container, so every tab is disconnected and finds out on its next join
- Unknown tiles render as eigengrau (`#16161d`), void outside map boundary renders as true black (`#000`)
- Dialogue system: `talk` action is processed through the tick pipeline via `executeFrame` → `startDialogue`. `dialogue:advance/choose/close` messages use the session-manager API directly. Dialogue lock: while `agent.talkingToNpcId` is set, all input is rejected (even if the active session was already cleaned up). Timeout is detected in `tickDialogues()` called from the tick loop. Client enters `dialogueMode` which intercepts W/S/E/Esc for dialogue navigation
- `DialogueBuilderApi.entry()` adds conditional entry points to dialogue trees. `entryPoints` are evaluated in `startDialogue()` against NPC beliefs to select the starting node
- **Turn-before-move:** `executeFrame` for direction input only updates `agent.facing` when the intended direction differs from current facing (no position change). A second input in the same direction actually moves. Client `DisplayState.predictMove` mirrors this logic. Interact (KeyE) checks only the tile directly in front of the player (predicted facing), not any adjacent tile
- **Facing-based interaction:** KeyE sends a single `{ type: "interact" }` frame. Server-side `dispatchInteract` resolves the agent's facing tile against a 5-rule priority (dialogue-entry-matching agent → talk; hostile agent → attack; same-faction no-entry → noop; resource tile → gather; else noop). Attack is facing-only for all callers including AI NPC goals. KeyQ is not bound.
- **NPC event system:** NPCs expose typed events via `s.npc(id).on(event, handler)`. Event map: `proximity:{enter,stay,leave}`, `talk:{start,end}`, `combat:{hit,death}` (see `shared/src/script-dsl/event-types.ts`). Handlers return `EventEffect[]` — a standalone type (not part of the shared `Effect` union) containing only `bubble` in MVP; `setFact`/`give`/`damage`/etc. live in the separate `Effect` union and are deliberately not allowed from event handlers (emitting them is a compile-time error; dialogue `action` nodes can run them). There is no trigger system: it was removed in spec 003, and quests should build on events plus dialogue actions. Multiple handlers per event compose via `flatMap` in registration order. A throwing handler is isolated (logged, others still run). Dispatch is snapshot-at-dispatch: a handler that registers more handlers mid-dispatch does not observe them this tick. `bubble(target, text, { durationTicks })` sets/clears the NPC speech bubble; special refs `$npc`/`$self`/`$player` are resolved against the payload. Event dispatch is independent of the dialogue input-lock: a locked NPC still receives events and its handlers still run.

## Known Debt

- **Input queue overflow drops a frame without an ack.** When more than `INPUT_QUEUE_CAP` (3) player frames wait on the server (a burst after network jitter, or more than one frame per tick for a while), `Agent.enqueueInput` drops the oldest one and does not advance `lastProcessedInput`. The client predicted that move, so the player is pulled back one step. Found by the fast-check property `server/test/rooms/input-ack.property.test.ts` (an `it.fails` test records it; smallest case: four moves in one tick). Fixing it is a gameplay decision: a larger cap adds input delay after a burst.

- AI movement is a greedy step (`stepToward` in `jev-controller.ts`); a beast behind water gets no step and re-asks Jev at most once per second. Upgrade to BFS over passable tiles when maps get obstacles.
- Player attacks have no cooldown (one per key press, up to 8/s). AI beasts wait ~1s between attacks, but the wait is stored on the attack goal: a new goal (target left sight and came back) can hit at once.
- Speech bubbles are drawn in the same pass as the agents (`client/src/renderer.ts`), so an agent drawn later covers a bubble (seen: a player diamond over "Greetings, traveler!"). Draw them in a top layer: a canvas pass after all agents, or a glass / UI layer above the canvas.
- Tabs of one browser share the stored player name (localStorage): a second tab joins with the same name, the server gives it a number ("Quiet Otter 2"), and the client does not keep that number. Not fixed on purpose.
- After death the HUD can still show the last HP before 0 (the `death` message arrives before the state patch).
- `material` and `currency` have no use since production and merchants were removed.
- A respawned village NPC (Farmer Reed or the innkeeper) is added back to `populationIds` without a cap check: if a player took the freed slot, the village is one over its cap until someone leaves. It also respawns on the first free territory tile, not at its post (Farmer Reed starts at (9,19), the innkeeper at (11,21)).

## TODO

The open items, their priority and the recent done items are in `TODO.md`. Read it before you start new work.
