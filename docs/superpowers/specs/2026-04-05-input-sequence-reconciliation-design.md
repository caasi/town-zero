# Input Sequence Reconciliation Design

**Date:** 2026-04-05
**Status:** Draft (rev 2 — addresses spec review)
**Problem:** Movement stutter and random snap-back during continuous tile movement, even with 1 player + few NPCs.
**Root cause:** Client prediction and server state have no shared reference point — client cannot tell which server state corresponds to which input, causing blind desync correction.
**Solution:** Adopt the Gambetta input-sequence reconciliation model. Replace the key-state movement model (`move:start`/`move:stop`) with a per-tick input model where each movement step is an individually sequenced message.

## References

- [Gabriel Gambetta — Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [Gabriel Gambetta — Live Demo (full JS source)](https://www.gabrielgambetta.com/client-side-prediction-live-demo.html)

## Key Design Decision: Per-Tick Input Model

The previous architecture used a **key-state model**: client sends `move:start` once on keydown, server autonomously moves the agent each tick while `heldDirection` is set. This is incompatible with Gambetta reconciliation because a single `move:start` maps to multiple server-side moves with no per-step seq tracking.

The new architecture uses a **per-tick input model**: client sends a `move` message every 125ms (matching server tick rate) while a movement key is held. Each message carries a unique seq number. The server processes exactly one `move` message per tick per agent, and reports the last processed seq back to the client.

This aligns 1:1 with Gambetta: every predicted client step has a unique seq, every server-processed step reports which seq it handled.

## Protocol Changes

### Client → Server

**Remove:** `move:start` and `move:stop` message types.

**Add:** `move` message with payload `{ direction, seq }`. Sent once per client tick (125ms) while a movement key is held. `seq` is a monotonically increasing integer per client session.

**Add:** `move:stop` message with payload `{ seq }`. Sent once when all movement keys are released. The server uses `seq` to flush the client's pending buffer (sets `lastProcessedInput = seq`).

### Server → Client

`AgentSchema` gains a `lastProcessedInput: number` field, synced via Colyseus state. Updated every time the server processes a `move` input or a `move:stop`. This field is per-player and only meaningful to the owning client; other clients ignore it. (Bandwidth tradeoff accepted for MVP simplicity; could be moved to a per-client message later.)

## Server Changes

### 1. Agent model — new fields

Add to simulation `Agent`:
- `lastProcessedInput: number = 0` — synced to schema, tracks last processed seq
- `moveQueue: Array<{ direction, seq }>` — transient, not synced; buffered inputs from client

### 2. Message handlers — replace `move:start`/`move:stop`

Remove `move:start` and `move:stop` handlers. Add:

**`move` handler:**
1. Validate agent exists, is alive
2. Validate direction is in `VALID_DIRECTIONS`
3. Push `{ direction, seq }` to `agent.moveQueue`

**`move:stop` handler:**
1. Clear `agent.moveQueue`
2. Clear `agent.heldDirection` (if retained for bot fallback)
3. Set `agent.lastProcessedInput = seq` (flushes client buffer)

### 3. Phase 1.5 — consume from moveQueue

Replace the current `heldDirection` processing with:

```
if agent.state === "idle" and agent.moveQueue.length > 0:
  input = agent.moveQueue.shift()    // dequeue oldest
  cmd = { type: "move", targetX/Y from input.direction }
  if validateCommand(cmd):
    executeCommand(cmd)              // turn-before-move applies
  agent.lastProcessedInput = input.seq   // always advance, even if rejected
```

One input consumed per tick. If `moveQueue` is empty, no movement — the agent stops naturally.

**Turn-before-move must advance seq.** If the server processes a turn (facing change only, no position change), `lastProcessedInput` still advances. This is critical for client-server parity.

**Queue depth cap:** Max 3 entries (≈ 375ms of buffered input). Drop oldest on overflow. This prevents a stale input backlog from accumulating if the client sends faster than the server consumes.

### 4. Schema sync

`syncAgent()` copies `agent.lastProcessedInput` to `AgentSchema.lastProcessedInput`. `AgentSchema` adds a `lastProcessedInput` field of type `number` using the `schema()` API.

### Not changed

- All other tick phases (1–8 except 1.5) are untouched.
- Non-movement commands (gather, attack, deposit, take, trade, talk) do not use this mechanism.
- Bot movement: bots still use the plan/command system, not `moveQueue`. `lastProcessedInput` stays 0 for bots.

## Client Changes

### 1. InputHandler — per-tick move messages + pending buffer

**Remove:** `onMoveStart` / `onMoveStop` callbacks that send `move:start`/`move:stop`.

**New state:**
```
inputSeq: number = 0
pendingInputs: PendingInput[]
```

Where `PendingInput = { seq: number, direction: string }`.

**`update()` (called every 125ms via throttle):**
1. If a movement key is held:
   a. `++this.inputSeq`
   b. `network.sendMove(direction, this.inputSeq)`
   c. Run `predictMove()` for local visual feedback
   d. If prediction succeeded, push `{ seq: this.inputSeq, direction }` to `pendingInputs`
2. If no movement key is held and `pendingInputs` is non-empty:
   a. Do nothing — buffer drains via server `lastProcessedInput` advancing (or via `move:stop` flush)

**`handleKeyUp()` (when last movement key released):**
1. `network.sendMoveStop(this.inputSeq)` — tells server to flush, carries current seq

This unifies the prediction and network-send paths into a single location (`update()`), eliminating the dual-path issue where keydown and timer could double-predict.

### 2. DisplayState — reconciliation replaces desync threshold

**Remove:** `MAX_DESYNC_TILES` constant and the Manhattan distance threshold check.

**`DisplayState` gains a reference to the fog tile source** (set during initialization, e.g. `displayState.setTileSource(fog)`), so replay can check terrain passability.

**`syncFromServer(agents, pendingInputs)` new logic:**

For the local player:
1. Accept server `(x, y, facing)` as authoritative baseline.
2. Remove all entries from `pendingInputs` where `seq <= agent.lastProcessedInput`.
3. Starting from the baseline, replay each remaining pending input through the `predictMove()` logic (turn-before-move + terrain passability via tile source).
4. The final position after replay becomes the new `displayX/Y` and `displayFacing`.

If `pendingInputs` is empty after step 2, `displayX/Y` equals server position exactly — zero desync.

For other agents: always update `displayX/Y/facing` from server state directly (unchanged from current behavior).

### 3. Remove `snapLocalPlayer`

No longer needed. When the player releases all movement keys:
- No new entries are added to `pendingInputs` (step 1 of `update()` is skipped).
- `move:stop` with current seq triggers server to set `lastProcessedInput = seq`.
- Next server state sync prunes all remaining entries, converging display to server position.

### 4. Clear buffer on state transition

When `syncFromServer` detects the local player's state changed away from `"idle"` (e.g. attacked, entered dialogue), clear `pendingInputs` entirely. The agent can no longer move, so predictions are invalid.

### 5. Retain renderX/Y lerp

`updateRender(dt)` exponential lerp from `renderX/Y` toward `displayX/Y` is unchanged. Reconciliation updates `displayX/Y` (logical tile coordinates); lerp smooths to `renderX/Y` (pixel coordinates). No visual snapping.

### 6. NetworkClient — new message types

**Remove:** `sendMoveStart(direction)`, `sendMoveStop()`.

**Add:**
- `sendMove(direction, seq)` — sends `"move"` message with `{ direction, seq }`
- `sendMoveStop(seq)` — sends `"move:stop"` message with `{ seq }`

## Edge Cases

### Direction switch mid-movement

Client sends `seq=5 east` at tick T, then `seq=6 north` at tick T+1. Server may only have processed seq=5 when it sends state. Client receives server position (reflecting east move), discards seq≤5, replays seq=6 (north) from server position. Correct.

### Server rejects a move (wall collision, terrain change)

Server position does not advance, but `lastProcessedInput` still advances (the input was *processed*, just rejected). Client reconciliation uses the non-advanced server position as baseline, replays remaining inputs. The rejected move's effect is automatically undone — this is the core snap-back elimination.

### Non-idle state interruption (attacked, dialogue, gathering)

Server stops processing `moveQueue` when agent is not idle. Client detects state !== "idle" in `syncFromServer` and clears `pendingInputs`. Display converges to server position immediately.

### Reconnection / late join

On player join (or reconnect to existing agent), server resets `agent.lastProcessedInput = 0` and clears `agent.moveQueue`. Client starts with `inputSeq = 0` and empty `pendingInputs`. Clean slate.

### Packet ordering

WebSocket (TCP) guarantees in-order delivery. `inputSeq` is monotonically increasing. `moveQueue` is a FIFO — inputs are consumed in order.

### Pending buffer overflow (safety valve)

Normal buffer size ≈ RTT / TICK_RATE_MS (1–3 entries). Client-side hard cap of 20 entries; if exceeded, clear buffer and snap to server position. Server-side `moveQueue` cap of 3 entries; drop oldest on overflow.

### `move:stop` convergence

When the player releases keys, `move:stop` carries the current `inputSeq`. Server sets `lastProcessedInput = seq` and clears `moveQueue`. On next state sync, client prunes all entries with `seq <= lastProcessedInput`, resulting in an empty buffer and display at server position. No lingering stale entries.

## Test Strategy

1. **Unit: predictMove replay** — Given a baseline position + array of pending inputs + tile terrain, verify final position matches expected. Cover: straight line, direction changes, turn-before-move, wall collision.
2. **Unit: reconciliation buffer pruning** — Given `lastProcessedInput = N`, verify entries with `seq ≤ N` are removed and entries with `seq > N` are retained.
3. **Unit: turn-before-move seq consistency** — Verify that a turn-only input (facing change without position change) advances `lastProcessedInput` on server and is correctly replayed on client.
4. **Unit: server rejection reconciliation** — Client predicts 3 steps east, server rejects step 2 (wall). Verify client reconciles to server position + replays step 3 from corrected baseline.
5. **Unit: move:stop convergence** — Client sends move:stop with seq=N, verify server sets `lastProcessedInput = N`, client prunes all entries, display equals server position.
6. **Unit: state transition clears buffer** — Agent state changes to "fighting", verify `pendingInputs` cleared and display snaps to server position.
7. **Unit: reconnection reset** — On player join, verify `lastProcessedInput` and `moveQueue` reset to 0/empty.
8. **Integration: simulated latency** — Client sends N movement inputs with artificial delay, server responds with intermediate states, verify no snap-back at any point.
