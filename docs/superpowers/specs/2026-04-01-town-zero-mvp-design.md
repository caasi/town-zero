# town-zero MVP Design Spec

## Overview

Multiplayer real-time ecosystem simulation .io game. Each world is a persistent small-scale ecosystem where players coexist with LLM-driven NPCs. Players can act directly or influence NPCs through dialogue. Village destruction = defeat.

**Core experience:** Social interaction — NPCs have their own lives, players are intervenors, not commanders. NPC routines generate dynamic tasks; players choose whether and how to engage.

**Player relations:** Cooperative with betrayal possible. All players lose if the village falls, but individuals can act selfishly (steal resources, manipulate NPCs against other players).

**Session model:** Infinite sandbox. World runs continuously, even with no players online.

## Tech Stack

- **Server:** Colyseus (TypeScript), monolithic, LLM worker extracted later if needed
- **Client:** Colyseus JS SDK + Canvas 2D (colored blocks for prototype)
- **LLM:** Server-side calls, ~10-30s per NPC
- **Tick rate:** 1-2 tick/s

## Section 1: World & Grid System

### Grid

- Rectangular grid map, MVP size: **40x40** (1600 tiles)
- Layout: 1 village + 1 monster den + 1 resource zone + 1 trade route + wilderness
- Each tile has a **TerrainType**: `plains`, `forest`, `mountain`, `water`, `road`
- Terrain affects: movement cost (forest slow, road fast), resource availability (forest yields material, plains yield food), buildability

### Vision

- Each Agent has a **vision radius** (varies by role; scouts see farther)
- Agents can only perceive entities and tile states within their vision
- Players have the same vision rules as NPCs (no omniscience)
- **Fog of war:** Previously seen tiles outside current vision show "last known state"

### Information Transfer

- Agents must be in **adjacent tiles** to exchange information (dialogue, intel, requests)
- Each Agent has a personal **MapMemory** — a sparse grid recording the last known state of each tile they've visited or seen
- Intel goes stale: agents remember the state "as of last observation", not real-time
- Settlements have no omniscient view — knowledge of the outside depends on what members bring back
- Scouts and merchants become strategically important as information carriers

### MapMemory

Each Agent maintains a sparse record of tiles they have observed:

```
MapMemory = Map<TileCoord, {
  terrain: TerrainType
  entities: EntitySnapshot[]    // what was there when last seen
  timestamp: number             // tick when last observed
}>
```

- **Updated automatically** each tick for all tiles within the Agent's vision radius
- Tiles outside vision retain their last recorded state (stale but available)
- Tiles never observed are unknown (blank on fog of war)
- Current vision is just the subset of MapMemory where `timestamp == currentTick`
- When two Agents are adjacent, they can merge MapMemory entries (share intel)

### Territory

- Each tile can have `owner: FactionId | null`
- Settlement territory = all tiles owned by that faction
- **MVP: territory is fixed at map initialization, no expansion/contraction**

## Section 2: Settlement Model

Villages and monster dens share the same Settlement abstraction.

### Structure

```
Settlement
  faction: FactionId
  type: "village" | "den"
  population: Agent[]
  inventory: { food, material, currency }
  territory: GridCell[]          // fixed in MVP
  structures: Structure[]
```

### Structures (MVP: 2 types only)

| Structure | Village variant | Den variant | Function |
|-----------|----------------|-------------|----------|
| Housing | House | Nest chamber | Determines population cap |
| Production | Farm, workshop | Hunting ground, worker nest | Requires Agent to operate + raw material input to produce |

- Structures occupy grid tiles and require materials to build
- Production facilities need an Agent actively operating them AND raw material input
- This drives the core gameplay: agents must leave the settlement to gather resources

### Population

- Population shrinks when food is insufficient (starvation)
- **MVP: no natural population growth**

### Ecosystem Loop

```
Production facility needs raw materials
  -> Agent goes out to gather/hunt
  -> Brings back raw materials
  -> Production facility produces food/material
  -> Population consumes food
  -> Insufficient food -> population declines
```

Villages and dens follow the same logic. Humanoid monsters need food, industrial goods, and habitat. Beasts need food and habitat. The difference is parameterization, not separate systems.

## Section 3: Agent & ActionCommand System

All controllable entities share the same control interface. The world simulation does not distinguish command sources.

### Agent Structure

```
Agent
  id: string
  position: { x, y }
  faction: FactionId
  role: string                  // "farmer" | "hunter" | "scout" | ...
  hp: number
  inventory: { food, material, currency }
  state: FSMState               // "idle" | "moving" | "gathering" | "fighting" | ...
  plan: ActionCommand[]         // queued commands
  mapMemory: MapMemory           // sparse grid of observed tiles
  controller: "player" | "llm" | "bot"
```

### ActionCommand (Unified Command Interface)

```
type ActionCommand =
  | { type: "move", target: { x, y } }
  | { type: "gather", resourceTile: { x, y } }
  | { type: "attack", targetId: string }
  | { type: "deposit", settlementId: string }
  | { type: "talk", targetId: string, optionId: string }
  | { type: "trade", targetId: string, offer: Resource, want: Resource }
  | { type: "take", settlementId: string, resource: Resource, amount: number }
  | { type: "idle" }
```

### Command Sources

- Player -> WebSocket input -> ActionCommand
- NPC -> LLM DSL output -> ActionCommand
- Disconnected player / test -> simple bot logic -> ActionCommand
- WorldSim only validates legality and executes; source is irrelevant

### FSM Execution Layer

- Agent receives a plan (array of ActionCommands) and executes sequentially
- Each tick processes current command: `move` advances one tile, `gather` takes N ticks
- Command complete -> next in queue -> queue empty -> return to `idle`
- Next LLM decision overwrites remaining plan

## Section 4: Resource & Economy System

### Three Resources

- **Food** — consumed by population each tick, produced by farms/hunting grounds from gathered raw materials
- **Material** — used to build/repair structures, produced from gathered raw materials
- **Currency** — obtained only from external merchants

### Resource Locations

- **Resource tiles** on the map: specific tiles have `resourceYield: food | material`, agents `gather` there
- **Agent inventory**: personal backpack, gathered resources carried here until deposited
- **Settlement inventory**: production facilities consume from here, output stored here

### Production Flow

```
Resource tile ->[Agent gather]-> Agent inventory ->[Agent deposit]-> Settlement inventory ->[Production facility]-> Output
```

### Consumption

- Each Agent consumes 1 food every N ticks from their **personal inventory**
- Agents must actively take food from settlement inventory into their backpack (via `take` action or automatic when in settlement territory)
- Agent's personal food reaches zero -> starts losing HP -> death -> population decline
- This applies everywhere — in settlement, in the field, on the road. No free feeding.

### External Merchants

- Periodically enter from map edge along the trade route
- Arrive at village, offer trade: currency for food/material
- Leave along trade route after trading
- Merchants are FreeAgents, not affiliated with any settlement
- Trade route blocked by monsters -> merchants intercepted/killed -> currency supply cut off

## Section 5: LLM Integration

### Call Frequency

- Each NPC every 10-30s (adjusted by role importance: village chief ~10s, common farmer ~30s)
- Skip call if Agent state unchanged and no new events while executing plan

### Input: Natural Language Summary

LLM receives the Agent's MapMemory + current vision formatted as readable text:

```
You are [name], a [farmer] of [village name].
Position: (12, 8), State: idle
Backpack: food x2, material x0
Settlement inventory: food x5, material x3, currency x2
You see:
- (13, 9) a monster, moving
- (11, 7) farmland, no one operating it
You remember:
- 20s ago at (15, 10) saw 3 monsters moving south
Available actions: move, gather, deposit, attack, idle
```

### Output: Structured JSON

ActionCommand array in JSON, fed directly into Agent's plan queue.

### Dialogue Tree System

NPCs have standard RPG-style dialogue trees defined as data scripts.

```
DialogueTree
  id: string
  nodes: Map<NodeId, DialogueNode>
  locals: Map<string, any>         // per-NPC-instance local variables (affinity, flags, etc.)

DialogueNode =
  | { type: "text", speaker: AgentId, content: string, next: NodeId }
  | { type: "choice", options: { label: string, next: NodeId, condition?: Expression }[] }
  | { type: "request", label: string, gateType: "llm", next_yes: NodeId, next_no: NodeId }
  | { type: "action", effect: Expression, next: NodeId }   // modify locals, give item, etc.
  | { type: "end" }
```

- Each NPC role has one or more DialogueTree assigned
- `locals` hold per-instance state: affinity toward player, quest flags, visit count, etc.
- `choice` nodes present options to the player; `condition` can hide unavailable options
- `request` nodes are where the player asks the NPC for something — these trigger the LLM dialogue gate
- `action` nodes mutate locals or trigger game effects (hand over item, change NPC plan, etc.)
- The `talk` ActionCommand opens the NPC's current dialogue tree at its root (or a resume point)

### Dialogue Gate

When the dialogue tree reaches a `request` node, trigger one extra LLM call:

```
[Agent's environment summary]
Player [name] requests: "Scout the north for me"
Given your current situation, will you agree? Reply y or n.
```

### Cost Control

- MVP: ~10 NPCs + some monsters, average 20s/call -> ~30 LLM calls/min
- Use cheapest model (Haiku-tier): short prompts, structured JSON output
- Skip calls when Agent has no new events and is mid-plan execution

## Section 6: Client / Server Architecture

### Server (Colyseus)

```
GameRoom extends Room<WorldState>
  WorldState (Schema, auto-synced to client)
    grid: Tile[]
    settlements: Settlement[]
    agents: Agent[]
    tick: number
  Simulation loop (1-2 tick/s)
    Validate and execute all Agent ActionCommands
    Resource production/consumption settlement
    Death/starvation checks
  LLM Scheduler
    Round-robin LLM decisions for each NPC
```

### Client (Canvas 2D)

```
Client
  Colyseus SDK <- receive WorldState delta updates
  Renderer (Canvas 2D)
    Colored blocks for entities, grid lines for map
  Input Handler
    Click tile -> move command
    Click entity -> interaction menu (attack/talk/trade)
    Dialogue menu -> talk command
  Fog of War
    Filter display based on player Agent's MapMemory
```

### Fog of War Implementation

- Server syncs **full** WorldState to client (simplicity)
- Client filters display based on player's MapMemory
- MVP does not prevent cheating — prototype trusts client

### Disconnect Handling

- Player disconnects -> `controller` switches from `"player"` to `"bot"`
- Bot logic: simple rules (hungry -> return to village, attacked -> flee), no LLM
- Player reconnects -> `controller` switches back to `"player"`, inherits current state

## Section 7: Session & Persistence

### Room Lifecycle

- Each GameRoom is an independent world
- World **never pauses** — simulation loop continues with no players, NPCs keep living
- Colyseus `autoDispose: false` keeps Room alive

### Persistence

- **MVP: in-memory only** — server restart resets world, no save/load
- Future: snapshot to DB, but not needed for MVP

### Player Session

- Player joins room -> assigned (or reconnected to) an Agent
- New player -> spawn new Agent at village
- Reconnect -> Colyseus `allowReconnection` to reclaim original Agent
- Max 4 players per Room

### Multiple Worlds

- Multiple GameRooms can run simultaneously, fully independent
- MVP: just one Room

## Future Considerations (Not in MVP)

- Territory expansion/contraction
- Population natural growth
- Settlement-level shared KnowledgeBase
- Defense structures
- Free-text player input with LLM intent parsing
- Full LLM dialogue generation
- World state persistence / snapshots
- External C4ISR observation API
- Elixir rewrite for production
