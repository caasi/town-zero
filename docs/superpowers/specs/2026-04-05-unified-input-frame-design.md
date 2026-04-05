# Unified InputFrame Architecture

**Date:** 2026-04-05
**Status:** Draft
**Replaces:** Dual-channel model (moveQueue + plan) from input-sequence-reconciliation

## Problem

The current architecture uses two separate channels for agent input:

1. **`moveQueue`** — per-tick movement inputs from players (with seq numbers for Gambetta reconciliation)
2. **`plan`** — action commands from players, LLM, and bots (gather, attack, deposit, etc.)

This dual-channel model creates priority conflicts: Phase 1.5 (moveQueue) and Phase 2 (plan) compete for the agent's tick, requiring explicit yield logic (`plan.length === 0` guard) and stale-input clearing (`moveQueue = []` on plan execute). Multi-tick FSM states (`gathering`, `fighting`) further complicate the flow — an agent locked in `gathering` state ignores all input for multiple ticks.

## Solution: Pure InputFrame

Replace both channels with a single **InputFrame** queue. One frame is consumed per tick per agent. All actions are instant (1 tick). No FSM states except `dead`.

### Industry Precedent

- **Valve Source Engine `CUserCmd`** — single struct per tick containing movement + actions
- **Overwatch Command Frame** — movement + abilities processed in the same frame
- **Roguelike unified action queues** — one action per turn with time costs

## Data Model

### InputFrame

```typescript
// shared/src/types.ts
interface InputFrame {
  seq: number;              // Incrementing sequence number for reconciliation
  direction?: Facing;       // Movement direction (turn-before-move unchanged)
  action?: FrameAction;     // Instant action; takes priority over direction
}

type FrameAction =
  | { type: "gather"; resourceTile: { x: number; y: number } }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: string; amount: number }
  | { type: "trade"; targetId: string; offer: string; offerAmount: number; want: string; wantAmount: number }
  | { type: "talk"; targetId: string }
  | { type: "idle" };
```

### Agent Fields

```typescript
class Agent {
  inputQueue: InputFrame[] = [];     // Replaces moveQueue + plan
  lastProcessedInput: number = 0;    // Reconciliation (unchanged)
  planBacklog: FrameAction[] = [];   // LLM/bot strategies, auto-shifts into inputQueue
}
```

**Removed fields:**
- `moveQueue: PendingInput[]`
- `plan: ActionCommand[]`
- `state` FSM (`"gathering"` / `"fighting"` — only `"idle"` / `"dead"` remain)
- `currentCommandTicks` / `currentCommandTarget` / `gatherTile` / `currentTargetId`

**Queue cap:** `INPUT_QUEUE_CAP` constant (reuse existing `MOVE_QUEUE_CAP = 3` value). Overflow drops oldest frames.

### Type Migration: FrameAction Replaces ActionCommand

`FrameAction` completely replaces `ActionCommand`. The `ActionCommand` type and the `commands.ts` module (`validateCommand` / `executeCommand`) are deleted. All validation and execution logic moves into `executeFrame()`. The `move` variant is removed — movement is handled by `InputFrame.direction`. Trade frames are assembled by the client after modal completion (the trade modal gathers parameters, then sends one `InputFrame` with the full trade action).

### seq = 0 Convention

Frames from `planBacklog` use `seq = 0`, meaning they do not update `lastProcessedInput`. Client reconciliation only tracks `seq > 0` frames (player input).

## Tick Processing

### New processTick Structure

```
Phase 1: Consume one InputFrame per alive agent
  - inputQueue non-empty → shift one frame
  - inputQueue empty & planBacklog non-empty → shift planBacklog[0], wrap as InputFrame(seq=0)
  - both empty → skip

Phase 2: Bot controller (idle bot agents)
  decideBotAction → produces FrameAction[] → writes to planBacklog

Phase 3–8: Unchanged (production, consumption, merchants, vision, memory merge, triggers)
```

### executeFrame(agent, frame, ctx)

Within a single InputFrame, **action takes priority over direction**. If both `action` and `direction` are present, only the action executes; `direction` is ignored. If only `direction` is present, turn-before-move logic applies.

```
if agent is in dialogue (activeSessions has entry for agent):
  reject frame — no movement or actions during dialogue

if frame.action:
  validate & execute action (instant, completes in 1 tick)
  - gather: check adjacent + resource exists → add 1 resource to inventory
            (resource type from grid.getResourceYield, not from frame)
  - attack: check adjacent + target alive → deal BASE_ATTACK_DAMAGE
  - deposit/take/trade/idle: same as current, single tick
  - talk: initiate dialogue via session-manager (see Dialogue section below)
  update lastProcessedInput if seq > 0

else if frame.direction:
  turn-before-move logic unchanged
  update lastProcessedInput if seq > 0
```

Aliveness is checked at frame consumption time per agent, not pre-computed at phase start. If agent A's attack kills agent B earlier in the same tick, agent B's frame is skipped.

### Dialogue: `talk` Moves Into Tick Pipeline

Currently `talk` is handled immediately in `GameRoom.onMessage`, bypassing the tick pipeline. In the unified model, `talk` becomes a `FrameAction` processed in Phase 1 like all other actions. This adds up to 125ms latency before dialogue starts (one tick).

`executeFrame` calls `sessionManager.startDialogue(agent, targetId)` for `talk` actions. While an agent has an active dialogue session, `executeFrame` rejects all frames (no movement or actions). This replaces the implicit FSM-based blocking.

The existing `dialogue:advance`, `dialogue:choose`, and `dialogue:close` messages remain as separate GameRoom message handlers — they are dialogue-internal navigation, not game actions.

### Phase Renumbering

Old Phases 1 / 1.5 / 2 collapse into new Phase 1 (InputFrame consumption). Old Phase 2.5 becomes new Phase 2 (bot controller). Phases 3–8 retain their number and content.

### Removed Processing

- `processGathering()` function — deleted entirely
- `processCombat()` cooldown logic — replaced with instant damage
- `GATHER_DURATION` / `ATTACK_COOLDOWN_TICKS` constants — deleted

## Client Changes

### InputHandler

```
Current: update() sends direction only → onSendMove(direction, seq)
         action keys (Q/E/T) send ActionCommand separately

New:     update() sends full InputFrame → onSendInput(frame)
         action keys assemble InputFrame { seq: ++inputSeq, action: {...} }
         can include direction simultaneously (if key held)
```

### Network Messages

```
Current:
  "move"      (direction, seq)
  "move:stop" (seq)
  "command"   (ActionCommand)

New:
  "input"     (InputFrame)       — single unified message type
  "input:stop" (seq)             — key release, stops held-key frame generation
```

**`input:stop` semantics:** Client stops generating frames from held keys. Server sets `agent.lastProcessedInput = seq` so the client can prune its pending buffer. Server does **not** clear `inputQueue` — frames already enqueued are still processed normally. This differs from the predecessor `move:stop` which cleared `moveQueue`; in the unified model, flushing would risk discarding intentional action frames.

### DisplayState Reconciliation

Core logic unchanged:

1. Accept server position/facing/lastProcessedInput as baseline
2. Filter pendingInputs (seq > lastProcessedInput)
3. Replay remaining — only direction portion for turn-before-move prediction

**Change:** `pendingInputs` type changes from `PendingInput` to `InputFrame`. Only frames with `direction` enter `pendingInputs` (pure action frames don't need position prediction).

## Bot / LLM Integration

### LLM Output

```
Current: LLM returns ActionCommand[] → agent.setPlan(commands)
New:     LLM returns FrameAction[] → agent.planBacklog = actions
```

Format change is minimal. Key differences:
- `gather` and `attack` are now single-tick actions. LLM repeats them for sustained behavior.
- `move` is removed from the action type — LLM does not directly control movement direction. Bot controller handles pathfinding → direction.
- `gather` FrameAction must include `resourceTile`. Bots/LLM compute the facing tile relative to agent position when producing gather actions.

### Bot Controller

```
Current: decideBotAction() → returns single ActionCommand
New:     decideBotAction() → returns FrameAction[], writes to planBacklog
```

### planBacklog Consumption

Each tick in Phase 1: if `inputQueue` is empty and `planBacklog` is non-empty, shift one entry, wrap as `InputFrame(seq=0)`, and execute.

LLM think interval is 10–30s (80–240 ticks). planBacklog fills with multiple steps at once, consumed one per tick.

### Player Override

When a player frame (`seq > 0`) is enqueued into `inputQueue`, all `seq = 0` frames are flushed from `inputQueue` and `planBacklog` is cleared. This handles reconnect after bot takeover — no stale bot frames execute ahead of the player's input.

## Gather / Attack Instant Actions

### Gather

```
Current: Enters "gathering" state → waits GATHER_DURATION (4 ticks) → yields 1 food
New:     Each gather frame instantly yields 1 food (1 tick)
```

Tile resource model unchanged — tiles have infinite resources (no quantity, no depletion). Resource cap and regeneration belong to the future TileObject system (separate spec).

### Attack

```
Current: Enters "fighting" state → deals BASE_ATTACK_DAMAGE every ATTACK_COOLDOWN_TICKS
New:     Each attack frame instantly deals BASE_ATTACK_DAMAGE (1 tick)
```

### Balance Note

Both changes increase effective rates significantly. Balance tuning (yield reduction, damage reduction, cooldown-like rate limiting) is deferred — this refactoring focuses on architectural unification. Current values are preserved as-is. Future iterations may reintroduce commitment windows (e.g., cooldown-based rate limiting or action cost in ticks) to restore strategic depth.

## Migration Summary

| Before | After |
|--------|-------|
| `moveQueue: PendingInput[]` | `inputQueue: InputFrame[]` |
| `plan: ActionCommand[]` | `planBacklog: FrameAction[]` |
| `agent.state`: idle/gathering/fighting/dead | `agent.state`: idle/dead |
| `heldDirection` (already removed) | — |
| `GATHER_DURATION` = 4 ticks | Instant (1 tick) |
| `ATTACK_COOLDOWN_TICKS` | Instant (1 tick) |
| `"move"` + `"command"` messages | `"input"` message |
| `processGathering()` | Deleted |
| `processCombat()` cooldown | Instant damage |
| `ActionCommand` type | `FrameAction` type (no `move` variant) |
| `validateCommand()` / `executeCommand()` | `executeFrame()` |
| `talk` in GameRoom.onMessage | `talk` FrameAction in tick Phase 1 |

## Out of Scope

- Tile resource cap / regeneration (future TileObject system)
- Balance tuning for instant gather/attack rates
- Animation system for multi-tick visual feedback
- `move` as LLM action type (bots use pathfinding → direction)
