# Client-Side Movement Prediction

## Problem

Movement feels laggy because `TICK_RATE_MS = 1000` (1 tick/s). When a player presses a movement key, the command waits 0-1000ms (avg 500ms) for the next server tick before the position updates. The client renders directly from Colyseus state with no interpolation, so movement appears as discrete 1-tile jumps at 1 Hz.

## Goals

- Movement input feels instant (< 50ms visual response)
- No changes to server tick rate or simulation logic
- Smooth tile-to-tile sliding animation instead of discrete jumps
- Graceful handling of prediction mismatches (e.g. server rejects move)

## Non-Goals

- Full Gambetta-style reconciliation with input sequence replay
- Predicting other players' movement
- Changing `TICK_RATE_MS` or server-side `validateCommand`

## Design

### Pipeline

```
Key press
  >>> client-side validation (TERRAIN_MOVE_COST from shared/)
  >>> pass? >>> update local display position + start slide animation + send command to server
  >>> fail? >>> do nothing (same as current behavior)

Server tick arrives (Colyseus state patch)
  >>> callbacks.listen detects position change
  >>> self: lerp display position toward server position (correction if mismatch, invisible if match)
  >>> others: lerp display position toward server position (interpolation)
```

### Components

#### 1. Client-side move validation (`input.ts`)

On key press, before sending the command, validate the move locally:

1. Look up `state.tiles.get(\`${tx},${ty}\`)`. If the tile does not exist (out of bounds), reject.
2. Read `tile.terrain` (a `string` from Colyseus schema). If the terrain is not a key in `TERRAIN_MOVE_COST`, reject (treat unknown terrain as impassable).
3. If `TERRAIN_MOVE_COST[terrain] === Infinity`, reject.
4. If the local player's agent state is not `"idle"` (e.g. `"gathering"`, `"fighting"`), reject -- the server tick loop only dequeues commands for idle agents, so predicting during other states would always mismatch.

If any check fails, do nothing (no command sent, no animation). This prevents the most common prediction failures. The `shared/` package already exports `TERRAIN_MOVE_COST`, so no server code changes needed.

#### 2. Display position layer (`renderer.ts`)

Introduce a per-agent `displayX`/`displayY` (tile-space floats) that the renderer uses instead of reading directly from Colyseus schema. This decouples visual position from authoritative state.

- For the local player: `displayX`/`displayY` updated immediately by prediction, then lerped toward server on patch
- For other agents: `displayX`/`displayY` lerped toward server position each frame

#### 3. Optimistic movement (`input.ts` / `main.ts`)

When a move command passes local validation:

1. Immediately update the local player's `displayX`/`displayY` to the target tile
2. Send the command to server as before (`room.send("command", cmd)`)

The display position is a local-only value; Colyseus state is never mutated client-side.

#### 4. Server reconciliation (`main.ts`)

Use Colyseus `callbacks.listen` or `callbacks.onChange` on each agent's `x`/`y` properties:

- **Self (local player):** When server position arrives, if it matches `displayX`/`displayY`, do nothing (prediction was correct). If it differs, lerp `displayX`/`displayY` toward server position over ~150ms. This handles rejected moves (e.g. a race condition where another agent blocks the tile).
- **Others:** Always lerp `displayX`/`displayY` toward the latest server position each frame.

#### 5. Slide animation (`renderer.ts`)

Replace the current integer-position rendering with smooth interpolation:

- Each agent has `renderX`, `renderY` (floating point pixel coords)
- Each frame: `renderX = lerp(renderX, displayX * TILE_SIZE, factor)` where `factor = 1 - (1 - 0.2) ^ (dt / 16.67)` for frame-rate-independent interpolation (`dt` = ms since last frame, 16.67 = 60fps baseline)
- This applies to ALL agents (self + others), giving the whole world a smoother look
- At 60fps, convergence takes ~150ms. At 30fps or 144fps, the visual result is the same.

### Data Model (client-only)

```typescript
interface AgentDisplay {
  displayX: number;  // predicted/interpolated tile X
  displayY: number;  // predicted/interpolated tile Y
  renderX: number;   // pixel X for rendering (lerped toward displayX * TILE_SIZE)
  renderY: number;   // pixel Y for rendering (lerped toward displayY * TILE_SIZE)
}

// Map<agentId, AgentDisplay> maintained in main.ts or a new display-state module
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Walk into water / unknown terrain | Client rejects locally, no command sent, no animation |
| Walk out of bounds (tile not in state) | Client rejects locally, no command sent, no animation |
| Move while gathering/fighting | Client rejects locally (agent state not idle) |
| Server rejects move (unknown reason) | Display lerps back to server position (~150ms slide back) |
| Rapid key presses (< 200ms apart) | Throttle unchanged (200ms), prediction queues naturally |
| Player disconnects mid-prediction | Connection error overlay shows, same as current |
| Other player moves | Lerp interpolation, no prediction |

### Files Changed

| File | Change |
|------|--------|
| `client/src/input.ts` | Add local move validation using tile state |
| `client/src/main.ts` | Maintain `AgentDisplay` map, wire up Colyseus callbacks for reconciliation |
| `client/src/renderer.ts` | Use `renderX/renderY` instead of integer tile positions, add lerp logic |
| `client/src/camera.ts` | Accept pixel-space floats instead of integer tile coords; `Camera.update(renderX, renderY)` computes viewport from pixel position directly |
| (no server changes) | |

### Dependencies

- `TERRAIN_MOVE_COST` from `@town-zero/shared` (already exported)
- Colyseus state callbacks (`callbacks.listen` or `callbacks.onChange`)
- Tile data from `state.tiles` (already synced to client)

### Future Considerations

If movement still feels laggy after this change, the next step is reducing `TICK_RATE_MS` (e.g. to 200-500ms). This design is compatible with any tick rate -- faster ticks just mean predictions are confirmed sooner.
