# Facing Direction + First NPC + Dialogue UI

**Date:** 2026-04-04
**Status:** Draft
**Scope:** Agent facing direction, first NPC (Farmer Reed), dialogue session protocol, client dialogue UI, bush tile objects

## Overview

Add facing direction to agents, create the first interactive NPC with a repeatable food-gathering quest, and implement the client-server dialogue protocol with an HTML DOM overlay UI.

## 1. Facing Direction

### Schema

```typescript
// shared/src/types.ts
type Facing = "north" | "south" | "east" | "west";
```

- **AgentSchema:** add `facing: "string"` (default `"south"`)
- **Agent class:** add `facing: Facing` field
- **Schema sync:** `syncAgentToSchema()` copies `agent.facing` → `schema.facing`

### Server Logic

- `executeMove()` computes facing from dx/dy **before** checking move validity — pressing a direction key means "turn that way", not necessarily "walk that way"
- Failed moves (wall, water) still update facing
- Idle does not change facing; agent keeps last direction
- Bot/LLM agents update facing when their move commands are processed (same code path)

### Client Rendering

- **Facing indicator:** 5px white circle drawn on the edge of the agent shape corresponding to `agent.facing`. Shape itself does not rotate.
- **Prepare for pixel head avatar:** indicator logic is separate from shape drawing, so shape rendering can be swapped out independently later.

### Dialogue Precondition

Pressing E (interact):
1. Target is adjacent (Manhattan distance = 1)
2. **Auto-face:** server automatically updates player facing toward the target before validation — if adjacent, the required facing is unambiguous, so forcing manual alignment adds frustration without strategic depth
3. Target has a dialogue tree
4. Target is not busy (`currentTalkingTo === null`)

## 2. Dialogue Session Protocol

### Approach: Message-per-step (Server Authoritative)

Every dialogue node transition is a server round-trip. Client is a pure renderer — it receives UI payloads and sends user choices. Server evaluates all conditions, executes all effects, and controls progression.

### ActionCommand Changes

The existing `talk` command has `{ type: "talk", targetId: string, optionId: string }`. The `optionId` field is removed — dialogue choices move to the dedicated `dialogue:choose` message. Updated type:

```typescript
| { type: "talk"; targetId: string }
```

`server/src/rooms/validation.ts` and `client/src/input.ts` must be updated to match.

### GameRoom Integration

`talk` remains an `ActionCommand` processed by the existing `onMessage("command", ...)` pipeline. When the simulation executes a `talk` command, it creates a dialogue session and sends `dialogue:state` back to the client.

The three dialogue protocol messages (`dialogue:advance`, `dialogue:choose`, `dialogue:close`) are **separate `onMessage` handlers** on `GameRoom`, not `ActionCommand`s. They bypass the plan queue and act immediately, since they are UI interactions within an already-active session, not simulation commands.

### Messages

**Client → Server:**

| Message | Payload | When |
|---------|---------|------|
| `talk` command | `{ type: "talk", targetId }` | Player presses E near NPC |
| `dialogue:advance` | `{}` | Player presses E on a text node |
| `dialogue:choose` | `{ optionId: string }` | Player selects a choice option |
| `dialogue:close` | `{}` | Player presses Esc |

**Server → Client:**

| Message | Payload | When |
|---------|---------|------|
| `dialogue:state` | `DialogueStatePayload` | Each visible node (text or choice) |
| `dialogue:end` | `{ reason: "complete" \| "timeout" \| "closed" }` | Dialogue session ends |
| `dialogue:error` | `{ reason: "busy" \| "too_far" \| "wrong_facing" \| "no_dialogue" }` | Talk command validation fails |

**DialogueStatePayload:**

This replaces the existing `DialogueStateMessage` from `dialogue-session.ts`. The existing type is renamed/superseded.

```typescript
type DialogueStatePayload = {
  npcId: string;
  npcName: string;
  nodeType: "text" | "choice";
  speaker?: string;
  content?: string;            // server-interpolated text template
  options?: Array<{
    id: string;
    label: string;
    enabled: boolean;          // condition fails → shown but greyed out (not hidden)
  }>;
  timeoutAt: number;           // server tick when session auto-closes
  // treeId and nodeId omitted from client payload (server-internal only)
};
```

**Option visibility vs enabled:** The existing `getVisibleOptions()` in `DialogueEngine` filters options by condition, hiding them entirely. This changes to: all options are always sent to the client, but with `enabled: false` when their condition fails. This lets the player see what's possible (e.g., "Here you go." greyed out when they don't have enough food), providing implicit feedback about requirements.

**Action nodes are transparent to client.** Server executes effects and skips to the next visible node (text/choice/end). Client never receives `nodeType: "action"`.

### One-to-One Locking

- NPC tracks `currentTalkingTo: string | null`
- Only one player can talk to an NPC at a time
- Other players pressing E on a busy NPC receive `dialogue:error { reason: "busy" }`

### Timeout

- `DIALOGUE_TIMEOUT_TICKS = 30` in `shared/src/constants.ts` (30 seconds at 1 tick/s)
- Server records `lastInteractionTick` on each `dialogue:advance` / `dialogue:choose`
- Tick loop checks all active sessions; expired sessions trigger `dialogue:end { reason: "timeout" }`
- Client displays countdown timer in dialogue footer; turns red + blinks when < 10 seconds remain
- `timeoutAt` is included in every `dialogue:state` payload so client can compute remaining time

### Player State During Dialogue

- Player enters `state: "talking"` — movement and all other actions (gather, attack, deposit, take) are blocked
- Only dialogue messages (`dialogue:advance`, `dialogue:choose`, `dialogue:close`) are accepted
- **Client-side timing:** client enters `dialogueMode` immediately on sending `talk` command (optimistic). If server responds with `dialogue:error`, client exits `dialogueMode`. Server's `state: "talking"` is the authoritative gate for command rejection; client `dialogueMode` is a UX-only flag to switch input handling

## 3. Server-Side Session Management

### Active Session State

The existing `DialogueSession` class in `server/src/dialogue/dialogue-session.ts` already wraps `DialogueEngine` and holds agent references + advance/select methods. Rather than defining a parallel interface, extend the existing class with timeout tracking fields:

```typescript
// Added to existing DialogueSession class:
lastInteractionTick: number;
startTick: number;
```

The existing `DialogueSession` already has `npc`, `player` (Agent refs), `engine` (DialogueEngine with tree state + currentNodeId), and `locals` (Map). No new class needed.

### Where State Lives

- **SimulationState** holds `activeSessions: Map<string, DialogueSession>` keyed by NPC agent ID. The session is a cross-agent relationship, not owned by either agent.
- **NPC agent:** `currentTalkingTo: string | null` — quick lock check
- **Player agent:** `state: "talking"` — blocks other actions
- **Player agent:** `talkingToNpcId: string | null` — O(1) session lookup from player side

### Session Lifecycle

```
talk command → validate → create session → lock NPC + player
  → evaluate entry node → send dialogue:state

dialogue:advance/choose → lookup session via player.talkingToNpcId
  → validate sender === session.playerId
  → advance tree, execute silent action nodes
  → update currentNodeId + lastInteractionTick
  → send dialogue:state (or dialogue:end)

dialogue:close / timeout / player disconnect
  → remove session from activeSessions
  → npc.currentTalkingTo = null
  → player.state = "idle", player.talkingToNpcId = null
```

### Timeout Check in Tick Loop

Runs each tick alongside existing phase checks:

```typescript
for (const [npcId, session] of state.activeSessions) {
  if (currentTick - session.lastInteractionTick > DIALOGUE_TIMEOUT_TICKS) {
    endDialogue(npcId, "timeout");
  }
}
```

### Existing dialogueProgress

`Agent.dialogueProgress: Map<string, DialogueProgressEntry>` is a **persistent cross-session record** (which node was last visited per NPC, which facts were set). `DialogueSession` is the **ephemeral current session**. They are separate concerns.

## 4. First NPC: Farmer Reed

### Scenario

Farmer Reed is a `role: "farmer"`, `faction: "village"`, `controller: "bot"` NPC placed inside the village settlement. Uses existing bot idle behavior (stays in territory).

### Dialogue Tree

```
greeting (text)
  "Our food stores are running low. Could you gather 5 food from the bushes nearby?"
    → quest-offer

quest-offer (choice)
  ├─ "Sure, I'll help."           → accept (action: set food_quest_active=true)
  │    → accept-text (text)       → done
  ├─ "What's in it for me?"       → haggle (text) → quest-offer (loop back)
  └─ "Not right now."             → refuse (text) → done

--- on return, when food_quest_active == true ---

check-return (text, entry condition: food_quest_active == true)
  "Welcome back. Do you have the food?"
    → check-food

check-food (choice)
  ├─ "Here you go." [when: has_item(player, "food", 5)]
  │    → hand-over (action: take 5 food, set food_quest_active=false)
  │      → thanks (text) → done
  └─ "Not yet."                   → not-yet (text) → done
```

### Entry Node Selection

The existing `DialogueTreeData` has a single `root: string` field. Rather than adding a complex conditional entry system, use a simpler approach: **`DialogueTreeData` gains an `entryPoints` field:**

```typescript
// Added to DialogueTreeData in shared/src/script-types.ts
entryPoints?: Array<{ nodeId: string; condition: Expr }>;
```

When starting a session, the server evaluates `entryPoints` in order. First match wins. If none match (or no `entryPoints` defined), falls back to `root`.

For Farmer Reed:
1. `{ nodeId: "check-return", condition: fact("food_quest_active").eq(true) }` — quest in progress
2. Falls back to `root: "greeting"` — default

The eDSL builder gets a corresponding `d.entry(nodeId, condition)` method.

### Repeatable

After hand-over, `food_quest_active` is set back to `false`. Next dialogue starts from `greeting` again.

## 5. Client Dialogue UI

### Style: Classic RPG

Bottom-of-screen semi-transparent dark box. NPC portrait placeholder (for future pixel head avatar) + name on left, dialogue text below, options list with highlight bar, key hints + countdown timer in footer.

### Module: `client/src/dialogue-ui.ts`

Public interface:

- `show(payload: DialogueStatePayload): void` — update DOM content, display overlay
- `hide(): void` — hide overlay
- `moveSelection(delta: -1 | 1): void` — W/S navigation, skips disabled options
- `getSelectedOptionId(): string | null` — returns selected option ID for E confirm
- `updateTimer(remainingSeconds: number): void` — update countdown display, < 10s adds warning style

### DOM Structure

```html
<div id="dialogue-overlay" class="hidden">
  <div class="dialogue-box">
    <div class="dialogue-header">
      <div class="dialogue-portrait"></div>
      <span class="dialogue-name"></span>
    </div>
    <p class="dialogue-text"></p>
    <hr>
    <ul class="dialogue-options"></ul>
    <div class="dialogue-footer">
      <span class="dialogue-timer"></span>
      <span class="dialogue-hints"></span>
    </div>
  </div>
</div>
```

Styled with CSS (inline or separate file). Vanilla DOM, no framework — module interface is clean enough to swap implementation later.

### Layout-Aware Key Hints

```typescript
async function getKeyLabel(code: string): Promise<string> {
  if ("keyboard" in navigator) {
    const layoutMap = await navigator.keyboard.getLayoutMap();
    return layoutMap.get(code)?.toUpperCase() ?? code;
  }
  return code.replace("Key", "");
}
```

Resolved once at startup, cached. Footer shows actual key labels for the user's layout (e.g., Dvorak: `[,] [O] select · [D] confirm · [Esc] close`).

### Input Integration

`input.ts` adds a `dialogueMode: boolean` flag:
- **true:** movement keys → dialogue navigation (up/down), E → confirm, Esc → close. All other action keys suppressed.
- **false:** existing behavior unchanged.

### Text Node vs Choice Node

- `text` → options area shows single "continue" prompt, E advances
- `choice` → options list, W/S select, E confirm

## 6. Bush Tile Objects (Minimal)

### Schema

Tile schema adds `objectType: "string"` (default `""`). Values: `""`, `"bush"`. Future: `"box"`, `"tree"`, etc.

Full tile object/prop system (durability, loot tables, interaction types) is deferred — tracked in CLAUDE.md TODO.

**Files that need `objectType` added:**
- `server/src/simulation/grid.ts` — `Grid.TileData` interface
- `server/src/rooms/schemas/TileSchema.ts` — Colyseus schema field
- `server/src/rooms/sync.ts` (or wherever `syncTiles` lives) — copy `objectType` to schema
- `client/src/types.ts` — `TileSnapshot` type
- `client/src/fog.ts` — `revealAround()` must capture `objectType` into snapshot (fog snapshots require explicit field plumbing, not automatic)

### Scenario Setup

Place 3-5 tiles with `objectType: "bush"`, `terrain: "plains"`, `resourceYield: "food"` east of the village settlement.

### Gather

No changes to gather logic. Existing `gather` action already picks up resources from tiles. Bush is a visual + semantic marker only.

### Client Rendering

`renderer.ts` `drawTile()`: if `snapshot.objectType === "bush"`, draw a small bush icon (green circles cluster) on top of terrain, before fog overlay.

## Non-Goals

- Quest tracking UI (no journal, no quest markers)
- Trigger system integration (pure dialogue flow, no register_trigger)
- Belief propagation of quest state to other NPCs
- Full tile object system (durability, loot tables)
- Frontend framework
- Pixel head avatars (facing indicator only, shape rendering stays)
- LLM integration for dialogue (script-only for this iteration)
