# Input Sequence Reconciliation Design

**Date:** 2026-04-05
**Status:** Draft
**Problem:** Movement stutter and random snap-back during continuous tile movement, even with 1 player + few NPCs.
**Root cause:** Client prediction and server state have no shared reference point — client cannot tell which server state corresponds to which input, causing blind desync correction.
**Solution:** Adopt the Gambetta input-sequence reconciliation model, adapted for discrete tile-based movement.

## References

- [Gabriel Gambetta — Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html)
- [Gabriel Gambetta — Live Demo (full JS source)](https://www.gabrielgambetta.com/client-side-prediction-live-demo.html)

## Protocol Changes

### Client → Server

`move:start` message payload changes from `{ direction }` to `{ direction, seq }`.

`move:stop` message payload changes from `{}` to `{ seq }`.

`seq` is a monotonically increasing integer per client session, incremented on every `move:start` call. `move:stop` sends the current seq value (no increment) to give the server a time-ordering reference.

### Server → Client

`AgentSchema` gains a `lastProcessedInput: number` field, synced via Colyseus state. Updated every time the server processes a movement input (including turn-only moves) in Phase 1.5 of the tick loop.

## Server Changes

Three targeted modifications:

### 1. Agent model — `lastProcessedInput` field

Add `lastProcessedInput: number = 0` to the simulation `Agent` type and `currentInputSeq: number = 0` as transient state (not synced, used to track the seq from the latest `move:start`).

### 2. `move:start` handler — store seq

In `GameRoom.onCreate`, the `move:start` handler stores `agent.currentInputSeq = seq` alongside `agent.heldDirection = direction`.

### 3. Phase 1.5 — update lastProcessedInput

In `processTick`, when Phase 1.5 processes a held-direction move (whether it results in actual movement or a turn-only facing change), set `agent.lastProcessedInput = agent.currentInputSeq`.

This is critical: **turn-before-move must advance the seq**. If the server processes a turn without advancing seq, the client replay will re-execute the turn and diverge by one step.

### 4. Schema sync

`syncAgent()` copies `agent.lastProcessedInput` to `AgentSchema.lastProcessedInput`. `AgentSchema` adds a `lastProcessedInput` field of type `number` using the `schema()` API.

### Not changed

- `move:stop` only clears `heldDirection`; no server ack needed (next state sync naturally reconciles).
- All other tick phases (1–8 except 1.5) are untouched.
- Non-movement commands (gather, attack, deposit, take, trade, talk) do not use this mechanism.

## Client Changes

### 1. InputHandler — seq counter + pending buffer

New state:
```
inputSeq: number = 0
pendingInputs: PendingInput[]
```

Where `PendingInput = { seq: number, direction: string }`.

On `sendMoveStart(direction)`:
1. `++this.inputSeq`
2. `network.sendMoveStart(direction, this.inputSeq)`
3. Run `predictMove()` for local feedback
4. If prediction succeeded, push `{ seq: this.inputSeq, direction }` to `pendingInputs`

On `sendMoveStop()`:
1. `network.sendMoveStop(this.inputSeq)` (current seq, no increment)

### 2. DisplayState — reconciliation replaces desync threshold

`syncFromServer()` replaces the current `MAX_DESYNC_TILES` threshold logic with:

1. Accept server `(x, y, facing)` as authoritative baseline.
2. Remove all entries from `pendingInputs` where `seq <= agent.lastProcessedInput`.
3. Starting from the baseline, replay each remaining pending input through `predictMove()` logic (turn-before-move + terrain passability check).
4. The final position after replay becomes the new `displayX/Y` and `displayFacing`.

If `pendingInputs` is empty after step 2, `displayX/Y` equals server position exactly — zero desync.

### 3. Remove `snapLocalPlayer`

No longer needed. When the player releases all movement keys, no new inputs are added to `pendingInputs`. The buffer drains as the server processes remaining inputs and advances `lastProcessedInput`. Within a few ticks, the buffer is empty and display converges to server position naturally.

### 4. Remove `MAX_DESYNC_TILES` constant

The desync threshold concept is replaced entirely by sequence-based reconciliation.

### 5. Retain renderX/Y lerp

`updateRender(dt)` exponential lerp from `renderX/Y` toward `displayX/Y` is unchanged. Reconciliation updates `displayX/Y` (logical tile coordinates); lerp smooths to `renderX/Y` (pixel coordinates). No visual snapping.

### 6. NetworkClient — updated message payloads

`sendMoveStart(direction, seq)` sends `{ direction, seq }`.
`sendMoveStop(seq)` sends `{ seq }`.

## Edge Cases

### Direction switch mid-movement

Client sends `seq=5 east`, then `seq=6 north`. Server may only have processed up to seq=5 when it sends state. Client receives server position (reflecting east move), discards seq≤5, replays seq=6 (north) from server position. Correct.

### Server rejects a move (wall collision, terrain change)

Server position does not advance, but `lastProcessedInput` still advances (the input was *processed*, just rejected). Client reconciliation uses the non-advanced server position as baseline, replays remaining inputs. The rejected move's effect is automatically undone — this is the core snap-back elimination.

### Non-idle state interruption (attacked, dialogue, gathering)

Server stops processing `heldDirection` when agent is not idle. Client `predictMove()` also checks `state === "idle"` and fails for non-idle agents. On reconciliation, pending replays fail, and `displayX/Y` converges to server position.

### Packet ordering

WebSocket (TCP) guarantees in-order delivery. `inputSeq` is monotonically increasing. Server only needs to track the latest seq, no reordering logic needed.

### Pending buffer overflow (safety valve)

Normal buffer size ≈ RTT / TICK_RATE_MS (1–3 entries). Add a hard cap of 20 entries. If exceeded, clear buffer and snap to server position. This handles extreme network conditions gracefully.

## Test Strategy

1. **Unit: predictMove replay** — Given a baseline position + array of pending inputs, verify final position matches expected. Cover: straight line, direction changes, turn-before-move, wall collision.
2. **Unit: reconciliation buffer pruning** — Given `lastProcessedInput = N`, verify entries with `seq ≤ N` are removed and entries with `seq > N` are retained.
3. **Unit: turn-before-move seq consistency** — Verify that a turn-only input (facing change without position change) advances `lastProcessedInput` on server and is correctly replayed on client.
4. **Unit: server rejection reconciliation** — Client predicts 3 steps east, server rejects step 2 (wall). Verify client reconciles to server position + replays step 3 from corrected baseline.
5. **Integration: simulated latency** — Client sends N movement inputs, server responds with intermediate states, verify no snap-back at any point.
