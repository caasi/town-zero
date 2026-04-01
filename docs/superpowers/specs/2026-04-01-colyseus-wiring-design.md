# Colyseus Wiring Design Spec

Wire the tested simulation engine (98 tests, 7 tick phases) back into Colyseus networking. Server-side only — no client rendering.

## Scope

**In scope:**
- Colyseus schemas mirroring SimulationState (Agent, Settlement, Grid, Structure)
- GameRoom wrapping SimulationState with `setSimulationInterval`
- One-way sync: SimulationState → Colyseus schemas each tick
- Player join → new Agent creation, assigned to village
- Player leave → Agent becomes bot-controlled (no deletion)
- Player commands via `onMessage` → ActionCommand pushed to agent plan
- Per-player vision data via targeted message
- Tests for schemas, sync, and GameRoom integration

**Out of scope:**
- Canvas renderer, HUD, fog of war rendering
- LLM API integration (bot controller rule-based logic is sufficient)
- Dialogue system wiring
- Character creation / rejoin identity matching
- Anti-cheat, persistence, multiple rooms

## Section 1: Colyseus Schemas

All schemas use the `schema()` function API (not `@type()` decorator, not `defineTypes()`).

### WorldStateSchema (Room state root)

```
WorldStateSchema
├── tick: number
├── width: number              // grid width (40), for client to interpret tile keys
├── height: number             // grid height (40)
├── agents: MapSchema<AgentSchema>
├── settlements: MapSchema<SettlementSchema>
└── tiles: MapSchema<TileSchema>
```

### AgentSchema

```
AgentSchema
├── id: string
├── faction: string
├── role: string
├── x: number
├── y: number
├── hp: number
├── maxHp: number
├── state: string              // FSMState value
├── controller: string         // "player" | "llm" | "bot"
├── currentTargetId: string    // nullable, empty string = no target
└── inventory: MapSchema<number>  // "food" → count, "material" → count, "currency" → count
```

### SettlementSchema

```
SettlementSchema
├── id: string
├── faction: string
├── type: string               // "village" | "den"
├── x: number                  // territory center (for client reference)
├── y: number
├── population: number         // derived: populationIds.length
├── maxPopulation: number      // derived: housing count × HOUSING_POPULATION_CAP
├── inventory: MapSchema<number>
└── structures: ArraySchema<StructureSchema>
```

### StructureSchema

```
StructureSchema
├── id: string
├── type: string               // "housing" | "production"
├── x: number
├── y: number
└── operatorId: string         // agent ID or empty string (no operator)
```

### TileSchema

```
TileSchema
├── x: number
├── y: number
├── terrain: string            // TerrainType value
├── resourceYield: string      // ResourceType or empty string
└── ownerFaction: string       // faction id or empty string
```

### Key decisions

- **Grid → sparse `MapSchema<TileSchema>`** with key `"x,y"`. 40×40 = 1600 tiles, but Colyseus only sends delta. Tiles are populated once at map generation and rarely change (only `ownerFaction` can change).
- **MapMemory is NOT in schema.** Per-agent private data. Sent via targeted `client.send("vision", data)` each tick.
- **Inventory as `MapSchema<number>`** with keys `"food"`, `"material"`, `"currency"`. Three entries per agent/settlement.
- **Settlement position** is territory center (first territory tile), not a separate field on the simulation Settlement. Computed during sync.
- **`currentTargetId`** and **`operatorId`** use empty string for null (Colyseus schema fields can't be null).
- **`nextMerchantId`** is internal to SimulationState and not synced to schema.
- **Grid dimensions** (`width`, `height`) are in WorldStateSchema so clients don't need to import shared constants.
- **Vision serialization:** `agent.getAllMemory()` returns a `Map<string, TileMemory>`. Convert to plain `Record` via `Object.fromEntries()` before sending as targeted message.

### File structure

```
server/src/rooms/schemas/
├── WorldStateSchema.ts
├── AgentSchema.ts
├── SettlementSchema.ts
├── StructureSchema.ts
└── TileSchema.ts
```

## Section 2: GameRoom

Replaces ChatRoom as the primary room. ChatRoom is kept for reference.

### Lifecycle

```
onCreate:
  generateMap() >>> createSimulationState() >>> populateSchemas() >>> setSimulationInterval(tickLoop, TICK_RATE_MS)

onJoin(client, options):
  createPlayerAgent(options.name) >>> addToVillage() >>> storeSessionMapping(client.sessionId, agentId)

onLeave(client):
  lookupAgentBySession(client.sessionId) >>> markAsBotControlled() >>> removeSessionMapping()

onMessage("command", handler):
  lookupAgentBySession(client.sessionId) >>> validateActionCommand(cmd) >>> agent.setPlan([cmd])

tickLoop:
  processTick(simState) >>> syncToSchema(simState, roomState) >>> sendVisionUpdates(clients)
```

### Internal state

```typescript
// Session → Agent mapping (side-effectful, lives in GameRoom)
private sessionToAgent: Map<string, string>  // sessionId → agentId

// Simulation state (source of truth, plain objects)
private simState: SimulationState

// Room state (Colyseus schema, read-only view synced each tick)
state: WorldStateSchema
```

### Player join

1. Check village population < maxPopulation. If full, reject join with error message.
2. Create a new `Agent` with `controller: "player"`, position within village territory
3. Add agent to `simState.agents`
4. Add agent ID to village `populationIds`
5. Store `sessionId → agentId` mapping
6. Sync happens automatically on next tick

Position selection: pick a random unoccupied tile within village territory.

### Player leave

1. Look up agent via `sessionToAgent`
2. Set `agent.controller = "bot"` — bot controller picks up on next tick
3. Remove session mapping
4. Agent stays in world, continues acting via bot logic

### Player commands

Client sends: `room.send("command", { type: "move", target: { x: 5, y: 3 } })`

Server:
1. Look up agent via session mapping
2. Validate agent exists and is alive (dead agents cannot receive commands)
3. Validate command shape via `isValidActionCommand(cmd: unknown): cmd is ActionCommand` — a manual type guard that switches on `cmd.type` and checks required fields per variant
4. `agent.setPlan([cmd])` — replaces any existing plan (single command, not queue)

No command batching for MVP. One command at a time.

### Agent death (player connected)

When a player-controlled agent dies during simulation:

1. Agent's `state` becomes `"dead"` via normal simulation logic (`takeDamage`)
2. Sync copies `state: "dead"` to AgentSchema — client can observe this via state change
3. Send targeted message `client.send("death", { agentId })` to the owning player
4. Remove `sessionToAgent` mapping — subsequent commands from this client are ignored
5. No respawn mechanic in MVP. Player remains connected but cannot act.

Dead agents are NOT removed from `simState.agents`. They persist with `hp: 0, state: "dead"`. The sync layer copies them as-is. Cleanup of dead agents is out of scope for MVP.

### Vision updates

Each tick, after sync:
1. For each player session in `sessionToAgent`:
   - Get agent's `MapMemory` via `getAllMemory()`
   - Send via `client.send("vision", serializedMemory)`
2. Vision data format: `{ tick: number, tiles: Record<string, TileMemory> }`

This is a targeted message, not schema state — only the owning player sees their own fog of war.

### File

```
server/src/rooms/GameRoom.ts
```

## Section 3: Sync Logic

Pure function. Takes SimulationState and WorldStateSchema, writes sim state into schema.

```
syncToSchema(simState: SimulationState, roomState: WorldStateSchema): void
```

### Sync rules

1. **`roomState.tick = simState.tick`**

2. **Agents:**
   - For each agent in `simState.agents`: create or update corresponding `AgentSchema` (including dead agents — they persist with `state: "dead"`)
   - For each schema key not in `simState.agents`: delete from `roomState.agents` (merchant walked off map — the only case where agents are removed from simState)
   - Copy: id, faction, role, x, y, hp, maxHp, state, controller, currentTargetId
   - Inventory: overwrite `MapSchema` entries for food, material, currency

3. **Settlements:**
   - For each settlement in `simState.settlements`: create or update `SettlementSchema`
   - Copy: id, faction, type, inventory, structures
   - Compute: `population = populationIds.length`, `maxPopulation = getPopulationCap()`
   - Position: `territory[0]` (first territory tile as reference point)
   - Structures: rebuild `ArraySchema<StructureSchema>` each tick (simple, structures rarely change)

4. **Tiles:**
   - Synced once during `onCreate`. In MVP, terrain, resourceYield, and ownerFaction are all static after map generation (no territory expansion mechanic exists). No per-tick tile sync needed.

### Side-effect isolation

All pure (no I/O, no timers, no network):
- `syncToSchema(simState, roomState)` — mutates schema, but input/output is deterministic
- `isValidActionCommand(cmd: unknown): cmd is ActionCommand` — runtime type guard, switches on `cmd.type`, checks required fields per variant
- `extractVisionForPlayer(agent)` — reads MapMemory, returns serializable object

Side effects concentrated in GameRoom:
- `client.send(...)` — network I/O
- `setSimulationInterval(fn, ms)` — timer
- `sessionToAgent` Map — mutable session state

### File

```
server/src/rooms/sync.ts
```

## Section 4: Server Entry Point Changes

`server/src/index.ts` currently registers ChatRoom. Changes needed:

1. Import GameRoom
2. Register as `gameServer.define("game", GameRoom)`
3. Keep ChatRoom registered (for reference/debugging)
4. Import `generateMap` to create initial world state (or let GameRoom handle it internally in `onCreate`)

## Section 5: Test Strategy

Three test layers, all Vitest.

### Layer 1: Schema unit tests (`server/test/schemas.test.ts`)

- Each schema can be instantiated via `schema()` API
- Nested schemas (Settlement → Structure) work correctly
- MapSchema operations (set, get, delete) on inventory and agents
- WorldStateSchema holds all sub-schemas

### Layer 2: Sync unit tests (`server/test/sync.test.ts`)

- Given SimulationState with 2 agents → syncToSchema → WorldStateSchema has 2 AgentSchemas with correct fields
- Agent dies → syncToSchema → AgentSchema persists with state "dead"
- Merchant walks off map (removed from simState.agents) → syncToSchema → AgentSchema removed from roomState
- Settlement resources change → syncToSchema → SettlementSchema inventory updated
- Agent inventory changes → syncToSchema → AgentSchema inventory MapSchema updated
- Agent state transition (idle → gathering) → reflected in schema
- Multiple ticks → tick counter increments correctly

### Layer 3: GameRoom integration tests (`server/test/game-room.test.ts`)

Uses Colyseus `ColyseusTestServer` for end-to-end testing:

- Player joins → agent appears in room state with correct faction/position
- Player sends move command → agent position changes after tick
- Player sends gather command → agent state becomes "gathering"
- Player leaves → agent controller becomes "bot"
- Multiple players join → multiple agents in state
- Bot agents act autonomously (bot controller runs)
- Settlement production runs (verify resource changes over ticks)
- Invalid command → ignored, no crash
- Player joins when village is at population cap → rejected with error
- Player sends command after agent dies → ignored
- Player sends malformed command (bad shape) → ignored
- Two players join, one attacks the other → combat resolves normally

## Section 6: Pipeline Summary

Implementation order:

```
TileSchema >>> StructureSchema >>> AgentSchema >>> SettlementSchema >>> WorldStateSchema
>>> sync.ts (pure function)
>>> GameRoom.ts (lifecycle + message handlers + tick loop)
>>> index.ts (register GameRoom)
>>> schema tests >>> sync tests >>> integration tests
```

Each step is independently testable before moving to the next.
