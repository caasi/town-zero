# 002 — Script Event System

**Status:** design
**Prerequisites:** 001 (combat-as-interaction) merged — relies on the proximity-bubble machinery landed there as a starting point.

## Goal

Let scenario authors register typed event handlers on NPCs — `s.npc(id).on("proximity:enter", h)` — instead of configuring each reactive behaviour via a purpose-built field. One typed surface for proximity, talk, combat, and future event kinds. Composable, unsubscribable, TSC-checked at the call site.

## Motivation

Today's scenario DSL mixes two models:

- **Declarative data** (`d.entry`, `d.action`, `TriggerRule`) — compiles to JSON-ish structures, reactive over beliefs.
- **Hand-wired config fields** (`proximityBubble: { text, durationTicks, cooldownTicks }`) — one field per feature; adds a new concept to every layer (shared type, DSL builder, NpcDefinition, Agent, tick pass) every time we want a new reactive behaviour.

A combat reaction ("Reed yells when hit below 20 HP") or talk hook ("clear bubble when talk starts") would each need their own config field today. That scales badly: the engine grows a vocabulary of special cases, and authors can't compose multiple reactions to the same stimulus.

The event-system approach, common to most engines (Godot signals, Unreal Event Dispatchers, Unity UnityEvent, Papyrus `Event OnX`, GMod `hook.Add`, WoW `RegisterEvent`), collapses the surface: one `.on(event, handler)` pattern, typed per event.

## Non-goals

- **Not** replacing `TriggerRule`. State → state reactions (e.g. `when food_quest_active then ...`) stay declarative. Events are for stimulus → effect with a payload.
- **Not** a scenario-level (global) event bus in v1. Only NPC-scoped events. (Scenario-level `s.on(...)` is called out in "Deferred" and may come later.)
- **Not** serialisable handlers. Handlers are runtime JS functions. Scenarios cannot be JSON-exported if they use `.on()`. This matches how Godot, Unity, and every closure-based engine handles it.
- **Not** a new effect execution model. Handlers return the existing `Effect[]`; the existing effect interpreter applies them.

## Design

### 1. Event map

A single TypeScript type declares every event key and its payload shape. Adding a new event kind means one line here, one overload on `.on()`, and one dispatch site in the tick pipeline.

```ts
// shared/src/script-dsl/event-types.ts

export interface EntityRef {
  id: string;
  faction: string;
  role: string;
  position: { x: number; y: number };
}

interface EventBase {
  tick: number;
  self: EntityRef;              // the NPC the handler is registered on
}

export interface ProximityEnterPayload extends EventBase {
  player: EntityRef;
  distance: number;
}
export interface ProximityStayPayload extends EventBase {
  player: EntityRef;
  distance: number;
  ticksInRange: number;
}
export interface ProximityLeavePayload extends EventBase {
  player: EntityRef;
}
export interface TalkStartPayload extends EventBase {
  player: EntityRef;
  dialogueId: string;
}
export interface TalkEndPayload extends EventBase {
  player: EntityRef;
  reason: "completed" | "timeout" | "player_left" | "npc_killed";
}
export interface CombatHitPayload extends EventBase {
  attacker: EntityRef;
  damage: number;
  hpAfter: number;
}
export interface CombatDeathPayload extends EventBase {
  killer: EntityRef | null;
}

export interface NpcEventMap {
  "proximity:enter": ProximityEnterPayload;
  "proximity:stay":  ProximityStayPayload;
  "proximity:leave": ProximityLeavePayload;
  "talk:start":      TalkStartPayload;
  "talk:end":        TalkEndPayload;
  "combat:hit":      CombatHitPayload;
  "combat:death":    CombatDeathPayload;
}

export type NpcEventName = keyof NpcEventMap;
export type EventHandler<P> = (ctx: P) => Effect[];
export type Unsubscribe = () => void;
```

Both participants are in the payload (Godot/Papyrus convention). No "who fired this?" global lookups.

### 2. Builder API — overloaded `.on()`

`s.npc(id, opts)` returns a chainable `NpcBuilder` (today it returns `void`). The builder exposes an overloaded `.on()`:

```ts
// shared/src/script-dsl/builders.ts
// SOURCE OF TRUTH for event keys + payloads: NpcEventMap (event-types.ts).
// These overloads must stay in sync — when adding a new event, update both.

export interface NpcBuilder {
  on(event: "proximity:enter", handler: EventHandler<ProximityEnterPayload>): NpcBuilder;
  on(event: "proximity:stay",  handler: EventHandler<ProximityStayPayload>):  NpcBuilder;
  on(event: "proximity:leave", handler: EventHandler<ProximityLeavePayload>): NpcBuilder;
  on(event: "talk:start",      handler: EventHandler<TalkStartPayload>):      NpcBuilder;
  on(event: "talk:end",        handler: EventHandler<TalkEndPayload>):        NpcBuilder;
  on(event: "combat:hit",      handler: EventHandler<CombatHitPayload>):      NpcBuilder;
  on(event: "combat:death",    handler: EventHandler<CombatDeathPayload>):    NpcBuilder;
}
```

Overloads (not a single generic signature) because:

- Autocomplete on `.on(` shows the event names as a dropdown.
- "No overload matches call" is a clearer error than a generic lookup failure.
- The catalog is rare-change; hand-written overloads are not a maintenance burden.

**Duplication cost.** The event map and the overload list are two places to edit when adding an event. Accepted. An alternative is a mapped-type derivation (`{ [K in keyof NpcEventMap]: ... }[keyof NpcEventMap]`) but autocomplete on the derived form regresses in practice. If the catalog grows past ~15 events the decision should be revisited.

The author-facing shape:

```ts
s.npc("farmer-reed", { ... })
  .on("proximity:enter", ({ player, self }) => [
    bubble(self, "Greetings, traveler!", { durationTicks: 40 }),
  ])
  .on("talk:start", ({ self }) => [
    bubble(self, "", { durationTicks: 0 }),  // clear bubble when dialogue opens
  ])
  .on("combat:hit", ({ hpAfter, self }) =>
    hpAfter < 20
      ? [bubble(self, "Help! I'm wounded!", { durationTicks: 16 })]
      : []
  );
```

### 3. Composability via flatMap

Multiple handlers for the same `(agent, event)` are allowed. Runtime dispatches in registration order and `flatMap`s the returned `Effect[]`:

```ts
function dispatch<K extends NpcEventName>(
  agent: Agent,
  event: K,
  payload: NpcEventMap[K],
): Effect[] {
  const handlers = agent.eventHandlers.get(event) ?? [];
  return handlers.flatMap(h => h(payload));
}
```

No author ceremony. Return `[]` to no-op. Helpers are trivial:

```ts
const compose = <P>(...hs: EventHandler<P>[]): EventHandler<P> =>
  p => hs.flatMap(h => h(p));
```

### 4. Unsubscribe

Two call surfaces, different return types:

- **Scenario-build `.on()`** — on the builder returned from `s.npc(...)`. Chainable: returns `NpcBuilder`. Registrations are **always static** for the lifetime of the loaded scenario; no disposer.
- **Runtime `agent.on(event, handler)`** — on the live `Agent` instance, reachable from inside another handler via `payload.self` (after resolving to `Agent`) or from server code. Returns `Unsubscribe = () => void`.

Dynamic wiring therefore always happens from inside a handler:

```ts
s.npc("reed", {...})
  .on("talk:end", ({ self, reason }) => {
    if (reason === "completed") {
      // stop greeting this player on future enters
      self.offByTag("greeting");   // or whatever runtime API we expose
    }
    return [];
  });
```

The exact runtime API for "find and remove a named handler" is a plan-stage detail — candidates: `agent.on(event, handler, { tag })` + `agent.off(tag)`, or returning an `Unsubscribe` from the runtime-form registration and having scenarios stash it in scenario-local state. The spec-level guarantee is: static scenario wiring cannot produce an `Unsubscribe`; dynamic wiring, if needed, uses the runtime form only.

### 5. Runtime storage

On `Agent`:

```ts
eventHandlers: Map<NpcEventName, EventHandler<unknown>[]> = new Map();
proximityState: Map<string, number> = new Map();   // playerId → ticksInRange
```

`proximityState.has(playerId)` acts as the "in range last tick" predicate; the value is the `ticksInRange` counter surfaced in `ProximityStayPayload`. One map, `get` gives the counter, `delete` on leave resets both presence and counter. `EventHandler<unknown>` (not `any`) keeps the shared-type surface honest; the dispatch site narrows via the declared overload.

Scenario-load (`loadScenario`) runs the `s.npc(...).on(...).on(...)` chain and for each `.on()` call pushes the handler into `agent.eventHandlers.get(event)`. The chain is metadata + runtime functions; not JSON-serialised.

### 6. Tick pipeline changes

**Remove** Phase 6b's proximity-bubble block (the current `cfg.text / cooldownTicks / bubble direct set`).

**Add** a new Phase 6b: **event dispatch**.

Per NPC per tick:

1. **Proximity diff.** Compute the set of player IDs currently within vision radius. For each NPC, walk `proximityState`:
   - Player in new set but not in map → dispatch `proximity:enter`; `set(playerId, 1)`.
   - Player in new set and in map → dispatch `proximity:stay` with `ticksInRange = map.get(playerId)`; `set(playerId, prev + 1)`.
   - Player in map but not in new set → dispatch `proximity:leave`; `delete(playerId)`.

   **Symmetry rule.** Proximity is computed from relative position. `:enter` fires on the first tick either side crosses into range, whether the NPC moved, the player moved, or both. `:leave` fires symmetrically. Handler authors who care about cause (e.g. "only greet when the player actively approached") must inspect payload deltas themselves; v1 does not filter. This matches Godot/Unity/Papyrus conventions and keeps the diff cheap.

2. **Apply effects.** `flatMap` the handler results into an `Effect[]`; apply via the existing effect interpreter.

Other events are dispatched from the subsystems that cause them:

- `talk:start` — `startDialogue` in `session-manager.ts` (replaces the hardcoded `target.setBubble("", ...)` with a dispatch).
- `talk:end` — `endDialogue` in `session-manager.ts`.
- `combat:hit` — `performAttackOnFacingTarget` / `executeDamage` in `execute-frame.ts`.
- `combat:death` — `Agent.applyDamage` when `hp` crosses to `≤ 0`. **Ordering guarantee:** on a killing blow, `combat:hit` dispatches first (with `hpAfter: 0`), then `combat:death`. Handlers for `combat:hit` may therefore observe `hpAfter === 0` and run before death effects resolve.

Each dispatch site calls `dispatch(agent, "talk:start", payload)` and applies the returned `Effect[]` before returning control.

**Dialogue-lock interaction.** Event dispatch is independent of the dialogue input-lock. A locked NPC still receives `proximity:enter/stay/leave` and `combat:hit/death` events, and its handlers still run. The lock only affects input processing; handler-emitted effects (setBubble, setFact, damage) apply normally. Handlers that would open a new dialogue (e.g. by emitting a `talk` effect) no-op because the target is busy — this is an engine-level invariant, not an event-system concern.

### 7. Removal of `proximityBubble` sugar

Delete from:

- `shared/src/script-types.ts` — `ProximityBubbleConfig` type **and** `NpcDefinition.proximityBubble` field. No v1 caller keeps the type; half-removals rot.
- `shared/src/script-dsl/builders.ts` — `ScenarioBuilderApi.npc` opts loses `proximityBubble?`.
- `server/src/simulation/agent.ts` — `Agent.proximityBubble` field, `proximityLedger` map, `getLastProximityTrigger`, `recordProximityTrigger` (and Agent init).
- `server/src/simulation/scenario-loader.ts` — the `proximityBubble: npcDef.proximityBubble` line.
- `server/src/simulation/tick.ts` — current Phase 6b proximity trigger block (replaced by event-dispatch pass).
- `server/src/rooms/proximity-cleanup.ts` — **rename to `proximity-state-cleanup.ts`**. Purpose: on `onLeave`, delete the departing playerId from every alive NPC's `proximityState` map. Same call site as today; same intent (make reconnects re-fire greetings). The old ledger semantics are preserved by the new map's `delete` key.

Farmer Reed's scenario migrates to `.on("proximity:enter", ...)`. All other call sites in `server/test/` that reference `proximityBubble` / `proximityLedger` are rewritten against `.on()` handlers.

## Files affected

| File | Change |
|---|---|
| `shared/src/script-dsl/event-types.ts` | **new** — `NpcEventMap`, payload types, `EntityRef`, `EventHandler`, `Unsubscribe` |
| `shared/src/script-dsl/builders.ts` | Add `NpcBuilder` interface with overloaded `.on()`; `s.npc()` returns `NpcBuilder`; remove `proximityBubble?` from opts |
| `shared/src/script-dsl/index.ts` | Export new types |
| `shared/src/script-types.ts` | Remove `proximityBubble?` field from `NpcDefinition`; delete `ProximityBubbleConfig` type |
| `server/src/simulation/agent.ts` | Remove `proximityBubble`, `proximityLedger`, related methods; add `eventHandlers`, `proximityState`; dispatch `combat:death` from `applyDamage` when HP crosses zero |
| `server/src/simulation/scenario-loader.ts` | Replace `proximityBubble` propagation with handler registration walk |
| `server/src/simulation/tick.ts` | Remove current Phase 6b; add event-dispatch phase with proximity diff |
| `server/src/simulation/event-dispatch.ts` | **new** — `dispatch<K>()` + effect application glue |
| `server/src/dialogue/session-manager.ts` | Replace hardcoded `setBubble("", ...)` with `dispatch(target, "talk:start", ...)` / `talk:end` |
| `server/src/simulation/execute-frame.ts` | Dispatch `combat:hit` after damage applied |
| `server/src/rooms/proximity-cleanup.ts` | Rename to `proximity-state-cleanup.ts`; delete departing playerId from each alive NPC's `proximityState` on `onLeave` |
| `server/src/scenarios/farmer-reed.ts` | Migrate to `.on("proximity:enter", ...)` and `.on("talk:start", ...)` |
| `server/test/**` | Update / add tests (see Testing) |

## Testing

Unit:

- `event-dispatch.test.ts` — `dispatch` composes multiple handlers via flatMap; handler order preserved; `[]` no-ops. **Throwing handler is isolated:** one handler throws, remaining handlers still run, tick does not crash, error logged with event name + agent id.
- `event-dispatch.test.ts` — **snapshot-at-dispatch:** a handler that registers a new handler mid-dispatch does *not* observe it this tick; the new handler activates on the next dispatch.
- `proximity-events.test.ts` — enter fires on first tick in range; stay fires on subsequent ticks with monotonic `ticksInRange`; leave fires exactly once when player drops out; re-enter resets `ticksInRange` to 1. **Symmetry test:** enter fires whether the NPC moved into the player or vice versa.
- `proximity-events.test.ts` — on player disconnect, `proximityState` entry is purged so reconnecting re-fires `proximity:enter`.
- `talk-events.test.ts` — `talk:start` fires on session open; `talk:end` fires with correct `reason` for each close path (complete / timeout / player leaves / npc dies).
- `combat-events.test.ts` — `hit` payload carries attacker, damage, hpAfter; `death` fires once at hp ≤ 0; on a killing blow, `combat:hit` dispatches strictly before `combat:death`.
- `builder.test.ts` — `.on()` chaining returns builder; each overload accepts matching handler; wrong payload shape fails `tsc` (negative test via `// @ts-expect-error`).

Integration:

- Migrated Farmer Reed scenario still greets on proximity, clears bubble on talk, behaves identically end-to-end.
- Multi-handler composition: register two `proximity:enter` handlers on Reed, both fire, effects concatenated in registration order.
- Dialogue-lock interaction: proximity events for a locked NPC still dispatch; handlers still emit effects.

## Migration path

One branch, one PR. No feature flag. The event system and the sugar removal ship together; there's no intermediate state where both paths exist.

Affected internal callers (tick code, session-manager, execute-frame) are updated to dispatch events alongside their existing logic. Handlers for the existing bubble behaviours are registered on Reed inside the scenario file — same observable behaviour, new mechanism.

## Risks / caveats

1. **Handler exceptions.** A throwing handler can blow up a tick. Runtime wraps each handler in `try/catch`, logs with event name + agent id, and continues with remaining handlers. Failed handler contributes no effects.
2. **Ordering.** Registration order. Document it. No priority system in v1 (easy to add later, hard to remove).
3. **Event storms.** Multiple players entering an NPC's range in the same tick produces multiple `proximity:enter` dispatches. Fine; flatMap absorbs. No tick-budget cap in v1.
4. **Serializable scenarios.** Lost. If ever needed (e.g. scenario editor UI), can add a parallel declarative surface; don't pre-build it.
5. **Dynamic subscribe from handler.** Mutating the handler list during dispatch must be safe. Implementation: snapshot the array at dispatch start (`[...handlers]`), iterate snapshot. New handlers registered mid-dispatch activate next tick.
6. **`combat:death` vs existing death handling.** The engine still does its own death bookkeeping (FSMState → "dead", etc.); event dispatch is additive.

## Deferred (out of scope)

- `s.on("tick", ...)` scenario-level events. Add when first concrete need appears.
- Priority / handler reordering.
- Handler cancellation (`return STOP_PROPAGATION`).
- Effect-returning vs. imperative handler split — keep effect-returning only; escape hatch can come later if scenarios need it.
- JSON serialisation of handlers — not needed until a scenario editor exists.

## Open questions (resolved)

- **Overloads vs. generic lookup?** Overloads. Better autocomplete and error messages.
- **Keep `proximityBubble:` sugar?** No. Remove entirely; scenarios use `.on()`.
- **Multiple handlers per event?** Yes, with flatMap composition.
- **Unsubscribe?** Yes; `.on()` imperative form returns `Unsubscribe`.
- **Scenario-level events (`s.on(...)`)?** Later, not v1.
