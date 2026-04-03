# Implementation Plan: Facing Direction + First NPC + Dialogue UI

**Spec:** `docs/superpowers/specs/2026-04-04-facing-npc-dialogue-design.md`
**Approach:** TDD — write tests first, then implement, verify all tests pass before each commit.

Split into 3 independent plans that can be executed in parallel (or sequentially). Each gets its own feature branch.

---

## Plan A: Facing Direction

**Branch:** `feat/facing-direction`

### Goal

Add `Facing` type, `facing` field to Agent, update facing on move, sync to schema, render indicator on client.

### Files to modify

| File | Change |
|------|--------|
| `shared/src/types.ts` | Add `Facing` type after `Position` (line 32) |
| `server/src/simulation/agent.ts` | Add `facing: Facing` field + `AgentInit` |
| `server/src/simulation/commands.ts` | `executeCommand` move case sets `agent.facing` |
| `server/src/rooms/schemas/AgentSchema.ts` | Add `facing: "string"` |
| `server/src/rooms/sync.ts` | `syncAgent` copies `agent.facing` |
| `client/src/renderer.ts` | Draw facing indicator (white dot on edge) |

### Tests

`server/test/simulation/agent.test.ts`:
- Agent initializes with `facing: "south"` by default
- Agent accepts custom `facing` in constructor

`server/test/simulation/commands.test.ts`:
- Move east → facing `"east"`, west → `"west"`, north → `"north"`, south → `"south"`

`server/test/rooms/sync.test.ts`:
- `syncAgent` copies facing to schema

### Implementation details

**shared/src/types.ts** — after `Position` interface:
```typescript
export type Facing = "north" | "south" | "east" | "west";
```

**server/src/simulation/agent.ts**:
- Import `Facing` (line 1 imports)
- `facing?: Facing` in `AgentInit`
- `facing: Facing` in class (after `role`)
- `this.facing = init.facing ?? "south"` in constructor

**server/src/simulation/commands.ts** — `executeCommand` move case (line 85-87):
```typescript
case "move": {
  const dx = cmd.target.x - agent.position.x;
  const dy = cmd.target.y - agent.position.y;
  if (dx > 0) agent.facing = "east";
  else if (dx < 0) agent.facing = "west";
  else if (dy > 0) agent.facing = "south";
  else if (dy < 0) agent.facing = "north";
  agent.position = { ...cmd.target };
  break;
}
```

**AgentSchema.ts** — add `facing: "string"` after `controller`

**sync.ts** — in `syncAgent` after line 20: `agentSchema.facing = agent.facing;`

**renderer.ts** — new `drawFacingIndicator` method called from `drawAgent` (after shape, before dead X):
- 5px white filled circle on edge corresponding to facing:
  - north: `(cx, py + 3)`, south: `(cx, py + TILE_SIZE - 3)`, east: `(px + TILE_SIZE - 3, cy)`, west: `(px + 3, cy)`
- Skip for dead agents

### Verify
```bash
pnpm run test && pnpm run build
```

---

## Plan B: Bush Tile Objects

**Branch:** `feat/bush-tile-objects`

### Goal

Add `objectType` field to tiles, place bushes east of village, render on client.

### Files to modify

| File | Change |
|------|--------|
| `server/src/simulation/grid.ts` | Add `objectType: string` to `TileData`, getter/setter |
| `server/src/rooms/schemas/TileSchema.ts` | Add `objectType: "string"` |
| `server/src/rooms/sync.ts` | Copy `objectType` in `syncTiles` |
| `client/src/types.ts` | Add `objectType?: string` to `TileSnapshot` |
| `client/src/fog.ts` | Capture `objectType` in `update()` and `revealAround()` |
| `client/src/renderer.ts` | Draw bush icon |
| `server/src/map/generator.ts` | Place bush tiles |

### Tests

`server/test/simulation/grid.test.ts`:
- `getObjectType` returns `""` by default
- `setObjectType` / `getObjectType` round-trips

`server/test/rooms/sync.test.ts`:
- `syncTiles` copies `objectType` to TileSchema

### Implementation details

**grid.ts** — `TileData` (line 4-9): add `objectType: string` (default `""`)
- `getObjectType(x, y): string` / `setObjectType(x, y, type: string): void`

**TileSchema.ts** — add `objectType: "string"`

**sync.ts** — `syncTiles` loop: `tile.objectType = grid.getObjectType(x, y);`

**client/src/types.ts** — `TileSnapshot`: add `objectType?: string`

**client/src/fog.ts**:
- `update()`: preserve `objectType` from existing snapshot
- `revealAround()`: add `objectType` to tile parameter type and snapshot object

**renderer.ts** — `drawTile()`: after reading `resourceYield`, if `objectType === "bush"`, draw green circles cluster (3 small filled arcs) on top of terrain, before fog overlay.

**generator.ts** — after resource zone (around line 66):
```typescript
const bushPositions = [
  { x: villageCx + 4, y: villageCy - 1 },
  { x: villageCx + 4, y: villageCy },
  { x: villageCx + 5, y: villageCy },
  { x: villageCx + 5, y: villageCy + 1 },
  { x: villageCx + 4, y: villageCy + 1 },
];
for (const pos of bushPositions) {
  grid.setObjectType(pos.x, pos.y, "bush");
  grid.setResourceYield(pos.x, pos.y, "food");
}
```

### Verify
```bash
pnpm run test && pnpm run build
```

---

## Plan C: Dialogue Protocol + Farmer Reed + Client UI

**Branch:** `feat/dialogue-protocol`
**Depends on:** Plan A (uses `agent.facing` for auto-face on talk), Plan B (bushes needed for quest)

### Step 1: Dialogue Protocol Types + Constants

**Goal:** Define `DialogueStatePayload`, update `talk` ActionCommand (remove `optionId`), add `DIALOGUE_TIMEOUT_TICKS`, add `entryPoints` to `DialogueTreeData`.

| File | Change |
|------|--------|
| `shared/src/types.ts` | Update `talk` type, add `DialogueStatePayload` |
| `shared/src/constants.ts` | Add `DIALOGUE_TIMEOUT_TICKS = 30` |
| `shared/src/script-types.ts` | Add `entryPoints` to `DialogueTreeData` |
| `server/src/rooms/validation.ts` | Remove `optionId` from `talk` validation |
| `client/src/input.ts` | Remove `optionId` from talk send |
| `client/src/main.ts` | Remove `optionId` from handleModal |

**Tests:**
- `server/test/rooms/validation.test.ts` — update `talk` case

**shared/src/types.ts** — line 70:
```typescript
| { type: "talk"; targetId: string }
```

Add after `TileMemory`:
```typescript
export interface DialogueStatePayload {
  npcId: string;
  npcName: string;
  nodeType: "text" | "choice";
  speaker?: string;
  content?: string;
  options?: Array<{ id: string; label: string; enabled: boolean }>;
  timeoutAt: number;
}
```

**shared/src/constants.ts**: `export const DIALOGUE_TIMEOUT_TICKS = 30;`

**shared/src/script-types.ts** — `DialogueTreeData`: add `entryPoints?: Array<{ nodeId: string; condition: Expr }>;`

**validation.ts** — simplify `talk`: `return typeof c.targetId === "string" && c.targetId.length > 0;`

**input.ts** line 217: `this.send({ type: "talk", targetId: npc.id });`

**main.ts** line 144: `network.send({ type: "talk", targetId: req.targetId });`

### Step 2: Server Session Management

**Goal:** `activeSessions` + `dialogueTrees` on `SimulationState`, extend `DialogueSession` with timeout, add agent lock fields, create session-manager module.

| File | Change |
|------|--------|
| `server/src/simulation/tick.ts` | Extend `SimulationState` with `activeSessions`, `dialogueTrees` |
| `server/src/simulation/agent.ts` | Add `talkingToNpcId`, `currentTalkingTo` |
| `server/src/dialogue/dialogue-session.ts` | Add timeout fields, `getAllOptionsWithStatus()`, public getters |
| New: `server/src/dialogue/session-manager.ts` | Lifecycle functions |

**Tests** (`server/test/dialogue/session-manager.test.ts`):
- `startDialogue` creates session, locks NPC + player, auto-faces player
- `startDialogue` returns error if NPC busy / not adjacent / no tree
- `startDialogue` evaluates `entryPoints` for root selection
- `endDialogue` clears session, unlocks both agents
- `advanceDialogue` / `chooseDialogue` advance tree and update `lastInteractionTick`
- `tickDialogues` times out expired sessions
- Agent in `talking` state blocks command processing

**agent.ts** — after `currentTargetId`:
```typescript
talkingToNpcId: string | null = null;
currentTalkingTo: string | null = null;
```

**tick.ts** — extend `SimulationState`:
```typescript
activeSessions: Map<string, DialogueSession>;
dialogueTrees: Map<string, DialogueTreeData>;
```

Update `generateMap` return + test fixtures to include these fields.

**dialogue-session.ts** — extend:
- `lastInteractionTick: number`, `startTick: number` (from `currentTick`)
- `updateTick(tick)`, `get npcId()`, `get playerId()`
- `getAllOptionsWithStatus(ctx)` → returns all options with `enabled` flag
- Update `select()` to validate `enabled`

**session-manager.ts** — functions:
```typescript
startDialogue(playerId, targetId, state): DialogueStatePayload | { error: string }
endDialogue(npcId, reason, state): void
advanceDialogue(playerId, state): DialogueStatePayload | { error: string }
chooseDialogue(playerId, optionId, state): DialogueStatePayload | { error: string }
tickDialogues(state): Array<{ playerId: string; reason: string }>
```

`startDialogue` also sets player facing (auto-face from spec):
```typescript
const dx = target.position.x - player.position.x;
const dy = target.position.y - player.position.y;
if (Math.abs(dx) >= Math.abs(dy)) {
  player.facing = dx > 0 ? "east" : "west";
} else {
  player.facing = dy > 0 ? "south" : "north";
}
```

### Step 3: Farmer Reed Scenario + eDSL Entry Points

**Goal:** `d.entry()` builder method, Farmer Reed dialogue tree, load on game start.

| File | Change |
|------|--------|
| `shared/src/script-dsl/builders.ts` | Add `entry()` to `DialogueBuilderApi` |
| New: `server/src/scenarios/farmer-reed.ts` | Scenario with dialogue tree |
| `server/src/map/generator.ts` | Load scenario, add Reed to village population |

**Tests:**
- `server/test/script-dsl/builders.test.ts` — `d.entry()` adds entry point
- `server/test/scenarios/farmer-reed.test.ts`:
  - Scenario builds without error
  - Tree has expected nodes
  - Entry point evaluation: `food_quest_active == true` → `check-return`
  - Full walkthrough: greet → accept → return → hand over

**builders.ts** — `DialogueBuilderApi`: add `entry(nodeId: string, condition: ExprBuilder): void;`
- Store `entryPoints` array in builder, include in `build()` output

**farmer-reed.ts** — see spec §4 for tree structure:
```
greeting → quest-offer (choice: accept/haggle/refuse)
  accept → action(set food_quest_active=true) → accept-text → done
  haggle → quest-offer (loop)
  refuse → done
check-return (entry: food_quest_active==true) → check-food (choice: hand-over/not-yet)
  hand-over → action(take 5 food, set food_quest_active=false) → thanks → done
  not-yet → done
```

**generator.ts** — after settlements, before return:
```typescript
const { triggerRegistry, dialogueTrees } = loadScenario(farmerReedScenario, state);
// state already has these fields from Step 2
state.triggerRegistry = triggerRegistry;
state.dialogueTrees = dialogueTrees;
// Add Farmer Reed to village population
village.populationIds.push("farmer-reed");
state.agents.get("farmer-reed")?.addToInventory("food", 5);
```

### Step 4: GameRoom Dialogue Integration

**Goal:** Wire message handlers, update tick loop, route dialogue events to clients.

| File | Change |
|------|--------|
| `server/src/rooms/GameRoom.ts` | Add dialogue message handlers + tick integration |
| `server/src/simulation/tick.ts` | Update `talk` case to invoke `startDialogue` |

**Tests** (`server/test/rooms/game-room.test.ts`):
- `talk` command creates session, sends `dialogue:state`
- `dialogue:advance` / `dialogue:choose` send updated `dialogue:state`
- `dialogue:close` sends `dialogue:end`
- Player in `talking` state rejects movement commands
- Timeout sends `dialogue:end`

**GameRoom.ts** — `onCreate()`:
- Add `onMessage("dialogue:advance")`, `onMessage("dialogue:choose")`, `onMessage("dialogue:close")`
- Each handler: lookup session via `sessionToAgent` → call session-manager → send response

**GameRoom.ts** — `tick()`:
```typescript
private tick() {
  processTick(this.simState);
  const expired = tickDialogues(this.simState);
  for (const { playerId, reason } of expired) {
    this.sendToAgent(playerId, "dialogue:end", { reason });
  }
  syncToSchema(this.simState, this.state);
  this.sendVisionUpdates();
  this.checkPlayerDeaths();
}
```

Add `sendToAgent(agentId, type, data)` helper (iterates `sessionToAgent`).

**tick.ts** — `case "talk"` (line 107-108): call `startDialogue()`, store pending result for GameRoom to send.

### Step 5: Client Dialogue UI

**Goal:** DOM overlay, dialogue mode input, network message wiring.

| File | Change |
|------|--------|
| New: `client/src/dialogue-ui.ts` | `DialogueUI` class |
| `client/index.html` | Dialogue overlay HTML + CSS |
| `client/src/input.ts` | `dialogueMode` flag + dialogue navigation |
| `client/src/network.ts` | `dialogue:*` message handlers + send methods |
| `client/src/main.ts` | Wire UI ↔ network ↔ input |

**client/index.html** — add dialogue overlay before trade modal, add CSS for bottom-of-screen dark box.

**dialogue-ui.ts**:
```typescript
export class DialogueUI {
  show(payload: DialogueStatePayload): void  // populate + display
  hide(): void
  moveSelection(delta: -1 | 1): void         // skip disabled
  getSelectedOptionId(): string | null
  updateTimer(remainingSeconds: number): void // warning < 10s
}
```

**input.ts** — `dialogueMode`:
- true: W/S → `moveSelection`, E → confirm (advance or choose), Esc → close
- false: unchanged
- `enterDialogueMode()`, `exitDialogueMode()`
- Callbacks: `onDialogueAdvance`, `onDialogueChoose(optionId)`, `onDialogueClose`

**network.ts** — register `dialogue:state`, `dialogue:end`, `dialogue:error` handlers. Add `sendDialogueAdvance()`, `sendDialogueChoose(optionId)`, `sendDialogueClose()`.

**main.ts** — wiring:
```typescript
network.onDialogueState → dialogueUI.show() + input.enterDialogueMode()
network.onDialogueEnd   → dialogueUI.hide() + input.exitDialogueMode()
network.onDialogueError → input.exitDialogueMode()
input.onDialogueAdvance → network.sendDialogueAdvance()
input.onDialogueChoose  → network.sendDialogueChoose()
input.onDialogueClose   → network.sendDialogueClose()
```

Key hints (layout-aware via `getKeyLabels()`):
- Text: `[E] Continue · [Esc] Close`
- Choice: `[W]/[S] Select · [E] Confirm · [Esc] Close`

Timer: `payload.timeoutAt - currentTick` in game loop. Red + blink when < 10s.

### Step 6: Integration Test + Cleanup

**Goal:** End-to-end test, CLAUDE.md updates.

| File | Change |
|------|--------|
| New: `server/test/integration-farmer-reed.test.ts` | Full flow |
| `CLAUDE.md` | Check off facing TODO, update dialogue TODOs |

**Test scenarios:**
1. Happy path: walk → talk → accept → gather → return → hand over → repeat
2. Busy NPC: second player gets `dialogue:error { reason: "busy" }`
3. Timeout: no response for 30 ticks → `dialogue:end { reason: "timeout" }`
4. Close: Esc → `dialogue:end { reason: "closed" }`
5. Disabled option: "Here you go." greyed out without 5 food

### Execution order within Plan C (Arrow DSL)

```
Step1 >>> Step2 >>> Step3 >>> Step4 >>> Step6
                              &&&
                            Step5
```

Steps 1-4 are sequential. Step 5 (client UI) can start after Step 1 (types exist) and run parallel with Steps 2-4. Step 6 runs last.

### Verify
```bash
pnpm run build && pnpm run test
```

---

## Cross-Plan Execution (Arrow DSL)

```
(Plan_A &&& Plan_B) >>> Plan_C
```

Plans A and B are independent — can execute in parallel worktrees. Plan C depends on both (uses `agent.facing` and bush tiles).
