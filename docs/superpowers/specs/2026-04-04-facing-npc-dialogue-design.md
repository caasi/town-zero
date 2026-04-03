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

Pressing E (interact) requires:
1. Target is adjacent (Manhattan distance = 1)
2. Player's `facing` points toward the target (e.g., player north of target → facing must be `"south"`)

## 2. Dialogue Session Protocol

### Approach: Message-per-step (Server Authoritative)

Every dialogue node transition is a server round-trip. Client is a pure renderer — it receives UI payloads and sends user choices. Server evaluates all conditions, executes all effects, and controls progression.

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
    enabled: boolean;          // disabled options shown but greyed out
  }>;
  timeoutAt: number;           // server tick when session auto-closes
};
```

**Action nodes are transparent to client.** Server executes effects and skips to the next visible node (text/choice/end). Client never receives `nodeType: "action"`.

### One-to-One Locking

- NPC tracks `currentTalkingTo: string | null`
- Only one player can talk to an NPC at a time
- Other players pressing E on a busy NPC receive `dialogue:error { reason: "busy" }`

### Timeout

- `DIALOGUE_TIMEOUT_TICKS = 30` in shared constants (30 seconds at 1 tick/s)
- Server records `lastInteractionTick` on each `dialogue:advance` / `dialogue:choose`
- Tick loop checks all active sessions; expired sessions trigger `dialogue:end { reason: "timeout" }`
- Client displays countdown timer in dialogue footer; turns red + blinks when < 10 seconds remain
- `timeoutAt` is included in every `dialogue:state` payload so client can compute remaining time

### Player State During Dialogue

- Player enters `state: "talking"` — movement and all other actions (gather, attack, deposit, take) are blocked
- Only dialogue messages (`dialogue:advance`, `dialogue:choose`, `dialogue:close`) are accepted

## 3. Server-Side Session Management

### DialogueSession

```typescript
interface DialogueSession {
  npcId: string;
  playerId: string;
  treeId: string;
  currentNodeId: string;
  locals: Map<string, unknown>;   // set_local scratch space, discarded on end
  lastInteractionTick: number;
  startTick: number;
}
```

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

When starting a dialogue session, server evaluates entry candidates in order and picks the first whose condition matches:
1. `check-return` — condition: `food_quest_active == true`
2. `greeting` — default (no condition)

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

### Scenario Setup

Place 3-5 tiles with `objectType: "bush"`, `terrain: "plains"`, `resourceYield: "food"` east of the village settlement.

### Gather

No changes to gather logic. Existing `gather` action already picks up resources from tiles. Bush is a visual + semantic marker only.

### Client Rendering

`renderer.ts` `drawTile()`: if `snapshot.objectType === "bush"`, draw a small bush icon (green circles cluster) on top of terrain, before fog overlay. `TileSnapshot` automatically captures `objectType` so explored tiles show remembered bushes.

## Non-Goals

- Quest tracking UI (no journal, no quest markers)
- Trigger system integration (pure dialogue flow, no register_trigger)
- Belief propagation of quest state to other NPCs
- Full tile object system (durability, loot tables)
- Frontend framework
- Pixel head avatars (facing indicator only, shape rendering stays)
- LLM integration for dialogue (script-only for this iteration)
