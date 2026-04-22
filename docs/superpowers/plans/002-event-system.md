# Script Event System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-wired `proximityBubble` NPC sugar with a typed, composable, TSC-checked event system: `s.npc(id).on("proximity:enter", handler)` etc. One surface for proximity/talk/combat; handlers return `EventEffect[]` and are composed by `flatMap`.

**Architecture:**
- A single TS event map (`NpcEventMap`) declares every event key and its payload shape. `s.npc()` returns an `NpcBuilder` exposing overloaded `.on(event, handler)` per key.
- At load time, scenario handlers are registered into `Agent.eventHandlers: Map<NpcEventName, EventHandler<unknown>[]>`. Dispatch sites (tick proximity diff, session-manager, combat damage) call a shared `dispatch<K>(agent, event, payload)` and the effect interpreter applies the returned effects.
- Event handlers return `EventEffect[]` — a standalone union that is **not** part of the general `Effect` union. In MVP `EventEffect` contains only `bubble`; `set_fact`/`damage`/`give_item`/etc. are deliberately excluded so returning them from an event handler is a compile-time error. Script-level triggers remain the path for broader effect emission. Keeping `bubble` out of `Effect` also keeps it off the dialogue executor's effect-application path. Bubble targets accept `$npc`/`$self`/`$player` refs resolved against the event payload.
- `proximityBubble` config, `proximityLedger`, `recordProximityTrigger`, etc. are deleted. `proximity-cleanup.ts` renamed to `proximity-state-cleanup.ts` and now purges `proximityState` entries on player leave.

**Tech Stack:** TypeScript (strict, ES2022), Node.js via tsx, Colyseus 0.17 + `@colyseus/schema` 4.x, Vitest. Monorepo with pnpm workspaces (`shared/`, `server/`, `client/`).

**Spec:** `docs/superpowers/specs/002-event-system-design.md`

**Prerequisites:** 001 (combat-as-interaction) merged — bubble/proximity machinery from 001 is the starting point that this plan replaces.

---

## File Structure

### Created files

| File | Responsibility |
|------|----------------|
| `shared/src/script-dsl/event-types.ts` | `NpcEventMap`, payload types (`ProximityEnterPayload`, …, `CombatDeathPayload`), `EntityRef`, `EventHandler<P>`, `Unsubscribe`. |
| `server/src/simulation/event-dispatch.ts` | `dispatch<K>(agent, event, payload): EventEffect[]` with snapshot-at-dispatch, per-handler try/catch, event-name+agent-id on error. `applyEventEffects(effects, state)` interprets `EventEffect` (bubble-only in MVP) into simulation mutations. |
| `server/src/simulation/apply-damage.ts` | `applyDamage(target, amount, attacker, state)` helper: calls `target.takeDamage`, dispatches `combat:hit` then (on lethal) `combat:death`, applies returned effects. Replaces direct `target.takeDamage` call sites. |
| `server/src/rooms/proximity-state-cleanup.ts` | Replaces `proximity-cleanup.ts`. `purgeProximityState(state, playerId)` deletes the player id from every NPC's `proximityState` on disconnect. Intentionally includes dead NPCs (skips only `controller === "player"` agents) so reconnecting players can re-fire `proximity:enter` against NPCs that were killed while disconnected, and so stale entries don't leak. |
| `server/test/simulation/event-dispatch.test.ts` | Composition via flatMap, handler-order preservation, `[]` no-op, throwing-handler isolation, snapshot-at-dispatch. |
| `server/test/simulation/proximity-events.test.ts` | Enter fires on first tick in range; stay fires monotonically; leave once; re-enter resets ticksInRange; symmetry (NPC-moved vs player-moved); reconnect re-fires after cleanup. |
| `server/test/dialogue/talk-events.test.ts` | `talk:start` fires on open; `talk:end` reason matches path (completed / timeout / player_left / npc_killed). |
| `server/test/simulation/combat-events.test.ts` | `combat:hit` payload fields correct; `combat:death` fires once at hp ≤ 0; `combat:hit` dispatches strictly before `combat:death` on killing blow. |
| `server/test/script-dsl/event-builder.test.ts` | `.on()` chaining returns builder; type of handler narrows per overload (`// @ts-expect-error` negative tests). |
| `server/test/rooms/on-leave-proximity-state.test.ts` | Replaces `on-leave-proximity.test.ts`. Asserts playerId removed from every NPC's `proximityState` (including dead NPCs). |

### Modified files

| File | Change |
|------|--------|
| `shared/src/script-types.ts` | Delete `ProximityBubbleConfig` type; remove `proximityBubble?` from `NpcDefinition`; add `handlers?: NpcHandlerEntry[]` runtime-only field. (Note: `bubble` is **not** added to the `Effect` union — it lives in a standalone `EventEffect` type in `script-dsl/event-types.ts` so it can only be emitted from event handlers, not from dialogue/trigger effects.) |
| `shared/src/script-dsl/builders.ts` | Drop `proximityBubble?` from `s.npc()` opts; `s.npc()` returns `NpcBuilder` with overloaded `.on()` (7 overloads matching `NpcEventMap`); add `bubble(target, text, opts)` Effect factory. |
| `shared/src/script-dsl/index.ts` | Export new `event-types` + `NpcBuilder`, `bubble`. |
| `server/src/simulation/agent.ts` | Remove `proximityBubble`, `proximityLedger`, `recordProximityTrigger`, `getLastProximityTrigger`, `forgetPlayerProximity`, `proximityBubble?` init opt. Add `eventHandlers: Map<NpcEventName, EventHandler<unknown>[]>`, `proximityState: Map<string, number>`. |
| `server/src/simulation/scenario-loader.ts` | Stop propagating `proximityBubble`. Walk `npcDef.handlers` and push each into `agent.eventHandlers`. |
| `server/src/simulation/tick.ts` | Remove old Phase 6b proximity-bubble block. New Phase 6b: proximity diff (compute player-ids-in-range, update `proximityState`, dispatch enter/stay/leave) → apply effects. Keep bubble expiry sweep. |
| `server/src/dialogue/session-manager.ts` | Replace hardcoded `target.setBubble("", 0, …)` in `startDialogue` with `dispatch(target, "talk:start", …)` + `applyEventEffects(...)`. Extend `endDialogue` signature to accept `reason`. Call sites: `tickDialogues` (reason: `"timeout"`), `advance/chooseDialogue` end branches (reason: `"completed"`), `GameRoom.onMessage("dialogue:close")` (reason: `"player_left"`). |
| `server/src/simulation/execute-frame.ts` / `facing-actions.ts` | `performAttackOnFacingTarget` calls the new `applyDamage` helper instead of `target.takeDamage` directly. |
| `server/src/dialogue/executor.ts` | Add `damage` effect path: uses `applyDamage` so triggers that damage agents also fire combat events. (No `bubble` handler here — `bubble` is not in the `Effect` union, so it can't reach the dialogue executor.) |
| `server/src/rooms/GameRoom.ts` | Import from `proximity-state-cleanup.ts`; call `purgeProximityState` in `onLeave`. In `onLeave`, when agent was mid-dialogue, call `endDialogue(..., "player_left")` (new reason arg). |
| `server/src/scenarios/farmer-reed.ts` | Remove `proximityBubble`; add `.on("proximity:enter", ({ self }) => [bubble(self.id, "Greetings, traveler!", { durationTicks: 40 })])` + `.on("talk:start", ({ self }) => [bubble(self.id, "", { durationTicks: 0 })])`. |
| `server/test/simulation/bubble.test.ts` | Remove tests that target deleted `proximityBubble`/`proximityLedger` API. Keep `setBubble` + expiry tests. Proximity-trigger behavior is verified in the new `proximity-events.test.ts`. |
| `server/test/rooms/on-leave-proximity.test.ts` | Delete; replaced by `on-leave-proximity-state.test.ts`. |
| `server/test/simulation/scenario-loader.test.ts` | Replace proximity-config assertions with handler-registration assertions. |
| `server/test/integration-farmer-reed.test.ts` | Unchanged observable behaviour; may need tick count / dialogue flow adjustments if timing shifts. |
| `CLAUDE.md` | Rewrite the "NPC bubble channel" paragraph to describe the event system. Remove the `proximityBubble` reference. |

---

## Notes for the implementer

1. **Spec §6 says dispatch `combat:death` from `Agent.applyDamage`. This plan deviates.** `Agent` is a pure data class today without access to `SimulationState`, and `combat:hit`/`combat:death` dispatch needs the state to apply effects. Instead, this plan adds a small `applyDamage(target, amount, attacker, state)` helper in `server/src/simulation/apply-damage.ts` and routes every damage call site through it (both `performAttackOnFacingTarget` and the `damage` effect in `executor.ts`). `Agent.takeDamage` stays pure. Same observable guarantees: `hit` always dispatches before `death`, `death` only on HP cross to ≤ 0.
2. **Standalone `EventEffect` type (not added to shared `Effect` union).** Spec §2 and §6 call for a `bubble(self, text, { durationTicks })` factory emitted by handlers. Do **not** add `bubble` to the shared `Effect` union: the dialogue executor in `executor.ts` would then accept `bubble` as a syntactically-legal dialogue/action/trigger effect and throw `Unknown effect type: bubble` at runtime. Resolution: define a standalone `EventEffect = { type: "bubble"; target: AgentRef; text: string; durationTicks: number }` in `shared/src/script-dsl/event-types.ts`, applied exclusively by `applyEventEffects` in `server/src/simulation/event-dispatch.ts`. `EventHandler<P>` returns `EventEffect[]`, which constrains handler output at compile time while leaving `Effect` untouched for dialogue/trigger code paths.
3. **Handlers are runtime-only.** `NpcDefinition.handlers` is typed but not JSON-serialised. Scenarios that use `.on()` cannot be round-tripped through JSON. Accept this — spec §0 non-goal #3.
4. **Snapshot-at-dispatch is load-bearing.** Spec §5 risk 5. A handler can register new handlers (via `agent.on(...)`); new handlers must not fire this tick. `dispatch` MUST copy the array (`[...handlers]`) before iterating. Test `event-dispatch.test.ts: registers handler mid-dispatch → new handler only fires next dispatch`.
5. **Throwing handler isolation.** Wrap each handler invocation in `try/catch`. Log `console.error(\`[event-dispatch] ${agent.id} ${event} handler ${i} threw:\`, err)`. Failing handler contributes no effects to the flatMap; remaining handlers still run; tick does not crash. Spec §7 risk 1.
6. **Ordering: `combat:hit` before `combat:death` on lethal blow.** Dispatch `combat:hit` with `hpAfter: 0` first, then `combat:death`. Both effect batches are flushed sequentially; do not interleave. Covered by `combat-events.test.ts`.
7. **Dialogue-lock does not gate event dispatch.** Even a locked NPC receives `proximity:*` and `combat:*` events; its handlers still run; handler-emitted `EventEffect[]` (bubble-only in MVP) apply normally. Non-bubble effects (`setFact`, `damage`, `give`, etc.) are intentionally excluded from `EventEffect` and are a compile-time error inside handlers — if a scenario needs those, emit them via a script-level trigger instead. Spec §6 "Dialogue-lock interaction."
8. **Proximity symmetry.** `:enter` fires on the first tick either side crosses into range. Compute from relative position every tick; do not branch on who moved. Spec §6 "Symmetry rule."
9. **One branch, one PR.** Spec "Migration path." No feature flag; event system and sugar removal ship together. Branch name: `feat/event-system`.
10. **TDD throughout.** Red → minimal green → commit. Use `@superpowers:test-driven-development`.
11. **Client unaffected.** The `bubbleText` field on `AgentSchema` is still broadcast; only the *source* changes (event-dispatch instead of direct setBubble in tick). No client-side change needed.

Before starting Task 1, create the branch:

```bash
git checkout -b feat/event-system
```

---

## Task 1: Add standalone `EventEffect` type + `bubble()` builder

**Files:**
- Create: `shared/src/script-dsl/event-types.ts` (standalone `EventEffect` type — **not** added to shared `Effect` union; see Note 2)
- Modify: `shared/src/script-dsl/builders.ts` (new `bubble` factory returning `EventEffect`)
- Modify: `shared/src/script-dsl/index.ts` (export `bubble` + `EventEffect`)
- Test: `server/test/script-dsl/event-builder.test.ts` (new)

- [ ] **Step 1: Write failing test for `bubble()` factory shape**

Create `server/test/script-dsl/event-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bubble } from "@town-zero/shared/script-dsl";

describe("bubble() effect factory", () => {
  it("returns a bubble Effect with target/text/durationTicks", () => {
    const eff = bubble("npc-1", "hello", { durationTicks: 40 });
    expect(eff).toEqual({ type: "bubble", target: "npc-1", text: "hello", durationTicks: 40 });
  });

  it("accepts durationTicks: 0 for clear", () => {
    const eff = bubble("npc-1", "", { durationTicks: 0 });
    expect(eff.durationTicks).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (no export)**

Run: `pnpm --filter @town-zero/server exec vitest run test/script-dsl/event-builder.test.ts`
Expected: FAIL "bubble is not exported".

- [ ] **Step 3: Define standalone `EventEffect` type in `shared/src/script-dsl/event-types.ts`**

`bubble` is deliberately **not** a member of the shared `Effect` union. The dialogue effect executor has no handler for it; adding it to `Effect` would make `bubble` syntactically legal in dialogue/action/trigger effects and throw `Unknown effect type: bubble` at runtime. Instead, keep it in a standalone `EventEffect` type that only the event-dispatch applier executes:

```ts
import type { AgentRef } from "../script-types.js";

export type EventEffect = {
  type: "bubble";
  target: AgentRef;
  text: string;
  durationTicks: number;
};
```

- [ ] **Step 4: Add `bubble()` helper to `shared/src/script-dsl/builders.ts`**

```ts
export function bubble(target: AgentRef, text: string, opts: { durationTicks: number }): EventEffect {
  return { type: "bubble", target, text, durationTicks: opts.durationTicks };
}
```

- [ ] **Step 5: Export `bubble` from `shared/src/script-dsl/index.ts`**

```ts
export {
  belief, setFact, give, take, damage, bubble, when, scenario,
} from "./builders.js";
```

- [ ] **Step 6: Rebuild shared, run test — expect PASS**

Run: `pnpm --filter @town-zero/shared run build && pnpm --filter @town-zero/server exec vitest run test/script-dsl/event-builder.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/script-types.ts shared/src/script-dsl/builders.ts shared/src/script-dsl/index.ts server/test/script-dsl/event-builder.test.ts
git commit -m "feat(events): add bubble Effect variant and builder"
```

---

## Task 2: Add event-types module

**Files:**
- Create: `shared/src/script-dsl/event-types.ts`
- Modify: `shared/src/script-dsl/index.ts`

- [ ] **Step 1: Create `shared/src/script-dsl/event-types.ts`**

```ts
import type { AgentRef } from "../script-types.js";

// Effects emitted by NPC event handlers. Deliberately kept tiny — and
// deliberately _not_ a member of the general `Effect` union — so that
// returning `set_fact`/`give_item`/`damage`/etc. from an event handler is
// a compile-time error, and so `bubble` cannot reach the dialogue executor.
export type EventEffect = {
  type: "bubble";
  target: AgentRef;
  text: string;
  durationTicks: number;
};

export interface EntityRef {
  id: string;
  faction: string;
  role: string;
  position: { x: number; y: number };
}

interface EventBase {
  tick: number;
  self: EntityRef;
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
  reason: "completed" | "timeout" | "player_left" | "npc_killed" | "error";
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
export type EventHandler<P> = (ctx: P) => EventEffect[];
export type Unsubscribe = () => void;
```

- [ ] **Step 2: Re-export from `shared/src/script-dsl/index.ts`**

Add:

```ts
export type {
  EntityRef,
  NpcEventMap,
  NpcEventName,
  EventHandler,
  Unsubscribe,
  ProximityEnterPayload,
  ProximityStayPayload,
  ProximityLeavePayload,
  TalkStartPayload,
  TalkEndPayload,
  CombatHitPayload,
  CombatDeathPayload,
} from "./event-types.js";
```

- [ ] **Step 3: Verify compile**

Run: `pnpm --filter @town-zero/shared run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add shared/src/script-dsl/event-types.ts shared/src/script-dsl/index.ts
git commit -m "feat(events): add NpcEventMap + payload types"
```

---

## Task 3: Add `NpcBuilder` + overloaded `.on()` in scenario builder

**Files:**
- Modify: `shared/src/script-types.ts` (`NpcDefinition.handlers`)
- Modify: `shared/src/script-dsl/builders.ts` (`s.npc()` returns `NpcBuilder`)
- Test: `server/test/script-dsl/event-builder.test.ts` (extend)

- [ ] **Step 1: Add failing test for `.on()` chain**

Append to `server/test/script-dsl/event-builder.test.ts`:

```ts
import { scenario, bubble } from "@town-zero/shared/script-dsl";

describe("s.npc().on() chaining", () => {
  it("returns builder from .on() so calls chain", () => {
    const data = scenario("test", (s) => {
      const b = s.npc("n1", { role: "villager", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
      const chained = b.on("proximity:enter", ({ self }) => [bubble(self.id, "hi", { durationTicks: 10 })]);
      expect(chained).toBe(b);
    });
    const npc = data.npcs[0];
    expect(npc.handlers).toHaveLength(1);
    expect(npc.handlers![0].event).toBe("proximity:enter");
  });

  it("accepts multiple overloads with distinct payload types", () => {
    const data = scenario("test", (s) => {
      s.npc("n1", { role: "villager", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] })
        .on("proximity:enter", ({ player }) => { void player.id; return []; })
        .on("talk:start",      ({ dialogueId }) => { void dialogueId; return []; })
        .on("combat:hit",      ({ hpAfter }) => { void hpAfter; return []; });
    });
    expect(data.npcs[0].handlers).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (no `.on`, no `handlers`)**

Run: `pnpm --filter @town-zero/server exec vitest run test/script-dsl/event-builder.test.ts`
Expected: FAIL compile or runtime.

- [ ] **Step 3: Add `handlers` field to `NpcDefinition`**

In `shared/src/script-types.ts`, add import:

```ts
import type { NpcEventName, EventHandler } from "./script-dsl/event-types.js";
```

Add to `NpcDefinition`:

```ts
export interface NpcHandlerEntry {
  event: NpcEventName;
  handler: EventHandler<unknown>;
}

export interface NpcDefinition {
  // ... existing fields ...
  handlers?: NpcHandlerEntry[];
}
```

- [ ] **Step 4: Add `NpcBuilder` + overloaded `.on()` in `shared/src/script-dsl/builders.ts`**

Add imports:

```ts
import type {
  NpcEventName, EventHandler,
  ProximityEnterPayload, ProximityStayPayload, ProximityLeavePayload,
  TalkStartPayload, TalkEndPayload,
  CombatHitPayload, CombatDeathPayload,
} from "./event-types.js";
import type { NpcHandlerEntry } from "../script-types.js";
```

Replace `ScenarioBuilderApi.npc(...)` return type `void` with `NpcBuilder`:

```ts
// SOURCE OF TRUTH for event keys + payloads: NpcEventMap (event-types.ts).
// Keep these overloads in sync with NpcEventMap.
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

In `scenario()`, replace `npc(...)` handler with:

```ts
npc(npcId, opts) {
  if (npcDialogueMap.has(npcId)) {
    throw new Error(`Duplicate npcId "${npcId}" in scenario "${id}"`);
  }
  npcDialogueMap.set(npcId, []);
  const handlers: NpcHandlerEntry[] = [];
  npcs.push({
    id: npcId,
    name: opts.name ?? npcId,
    role: opts.role,
    faction: opts.faction,
    position: opts.position,
    initialBeliefs: opts.initialBeliefs,
    dialogueIds: npcDialogueMap.get(npcId)!,
    handlers,
  });

  const builder: NpcBuilder = {
    on(event: NpcEventName, handler: EventHandler<any>): NpcBuilder {
      handlers.push({ event, handler: handler as EventHandler<unknown> });
      return builder;
    },
  };
  return builder;
},
```

Also remove `proximityBubble?: ProximityBubbleConfig` from the `ScenarioBuilderApi.npc` options and its propagation line `proximityBubble: opts.proximityBubble` — it is gone in Task 4, but the type change must happen here because the return-type change is on the same signature.

- [ ] **Step 5: Export `NpcBuilder` from `shared/src/script-dsl/index.ts`**

Add:

```ts
export type { NpcBuilder } from "./builders.js";
```

- [ ] **Step 6: Rebuild shared, run test — expect PASS**

Run: `pnpm --filter @town-zero/shared run build && pnpm --filter @town-zero/server exec vitest run test/script-dsl/event-builder.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/src/script-types.ts shared/src/script-dsl/builders.ts shared/src/script-dsl/index.ts server/test/script-dsl/event-builder.test.ts
git commit -m "feat(events): s.npc() returns NpcBuilder with overloaded .on()"
```

---

## Task 4: Delete `ProximityBubbleConfig` + `proximityBubble` field

**Files:**
- Modify: `shared/src/script-types.ts` (delete `ProximityBubbleConfig` type + field)
- Modify: `server/src/simulation/agent.ts` (delete import + field + methods)
- Modify: `server/src/simulation/scenario-loader.ts` (stop propagating)

This task breaks the build intentionally (callers remain); Task 5–6 restore it. Commit in one shot.

- [ ] **Step 1: Delete `ProximityBubbleConfig` type and field from `shared/src/script-types.ts`**

Remove the `ProximityBubbleConfig` interface entirely. Remove `proximityBubble?: ProximityBubbleConfig` from `NpcDefinition`.

- [ ] **Step 2: Remove `ProximityBubbleConfig` re-export from `shared/src/types.ts` / `shared/src/index.ts`**

Grep to confirm:

Run: `rg "ProximityBubbleConfig" shared/src server/src`

Remove every occurrence in `shared/` (keep in `server/` for the moment — they break compile deliberately).

- [ ] **Step 3: In `server/src/simulation/agent.ts`, remove `proximityBubble` field and ledger API**

Delete:
- `proximityBubble?: ProximityBubbleConfig;` field
- `proximityLedger: Map<string, number>` field
- `recordProximityTrigger`, `getLastProximityTrigger`, `forgetPlayerProximity` methods
- `proximityBubble?` from `AgentInit`
- `this.proximityBubble = init.proximityBubble;` in constructor
- The `import type { … ProximityBubbleConfig }` and `export type { ProximityBubbleConfig }` lines

- [ ] **Step 4: In `server/src/simulation/scenario-loader.ts`, remove `proximityBubble: npcDef.proximityBubble`**

Delete that line from the `new Agent({...})` init.

- [ ] **Step 5: Build — expect errors in tick.ts / session-manager.ts / tests**

Run: `pnpm run build`
Expected: FAIL with references to `proximityBubble`, `recordProximityTrigger`, etc. These are removed in later tasks. Note the error locations for Task 7+.

- [ ] **Step 6: Commit (knowingly broken — Task 5-6 restore)**

```bash
git add shared/src/script-types.ts server/src/simulation/agent.ts server/src/simulation/scenario-loader.ts
git commit -m "refactor(events): delete ProximityBubbleConfig and legacy ledger API

Breaks build; restored in subsequent tasks as event system lands."
```

---

## Task 5: Add `eventHandlers` + `proximityState` to Agent

**Files:**
- Modify: `server/src/simulation/agent.ts`
- Test: `server/test/simulation/agent.test.ts` (extend)

- [ ] **Step 1: Write failing test**

Add to `server/test/simulation/agent.test.ts`:

```ts
import type { NpcEventName, EventHandler } from "@town-zero/shared/script-dsl";

describe("Agent.eventHandlers + proximityState", () => {
  it("exposes empty eventHandlers and proximityState maps", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    expect(a.eventHandlers.size).toBe(0);
    expect(a.proximityState.size).toBe(0);
  });

  it("accepts handler registration under a known event key", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const h: EventHandler<unknown> = () => [];
    const key: NpcEventName = "proximity:enter";
    a.eventHandlers.set(key, [h]);
    expect(a.eventHandlers.get(key)).toEqual([h]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/agent.test.ts`
Expected: FAIL / compile error.

- [ ] **Step 3: Add fields in `server/src/simulation/agent.ts`**

Add imports:

```ts
import type { NpcEventName, EventHandler } from "@town-zero/shared/script-dsl";
```

Add fields:

```ts
  eventHandlers: Map<NpcEventName, EventHandler<unknown>[]> = new Map();
  proximityState: Map<string, number> = new Map();
```

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/agent.test.ts
git commit -m "feat(events): add eventHandlers and proximityState to Agent"
```

---

## Task 6: Event-dispatch module + effect application

**Files:**
- Create: `server/src/simulation/event-dispatch.ts`
- Test: `server/test/simulation/event-dispatch.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/test/simulation/event-dispatch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { dispatch, applyEventEffects } from "../../src/simulation/event-dispatch.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EntityRef, ProximityEnterPayload } from "@town-zero/shared/script-dsl";
import { bubble } from "@town-zero/shared/script-dsl";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

function refOf(a: Agent): EntityRef {
  return { id: a.id, faction: a.faction, role: a.role, position: { ...a.position } };
}

describe("dispatch", () => {
  it("flatMaps multiple handler results in registration order", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.eventHandlers.set("proximity:enter", [
      () => [bubble("n1", "one", { durationTicks: 1 })],
      () => [bubble("n1", "two", { durationTicks: 1 })],
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    const effects = dispatch(npc, "proximity:enter", payload);
    expect(effects.map(e => (e.type === "bubble" ? e.text : e.type))).toEqual(["one", "two"]);
  });

  it("isolates throwing handler — remaining handlers still run", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.eventHandlers.set("proximity:enter", [
      () => { throw new Error("boom"); },
      () => [bubble("n1", "survived", { durationTicks: 1 })],
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    const effects = dispatch(npc, "proximity:enter", payload);
    expect(effects).toHaveLength(1);
    expect((effects[0] as any).text).toBe("survived");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("snapshot-at-dispatch: newly registered handler does not fire this dispatch", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const calls: string[] = [];
    npc.eventHandlers.set("proximity:enter", [
      () => {
        calls.push("h1");
        npc.eventHandlers.get("proximity:enter")!.push(() => { calls.push("h-new"); return []; });
        return [];
      },
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    dispatch(npc, "proximity:enter", payload);
    expect(calls).toEqual(["h1"]);                      // no h-new this tick
    dispatch(npc, "proximity:enter", payload);
    expect(calls).toEqual(["h1", "h1", "h-new"]);       // fires next dispatch
  });

  it("returns [] when no handlers are registered", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    expect(dispatch(npc, "proximity:enter", payload)).toEqual([]);
  });
});

describe("applyEventEffects", () => {
  it("applies bubble effect to the target agent", () => {
    const state = buildState();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(npc.id, npc);
    applyEventEffects([bubble("n1", "hi", { durationTicks: 5 })], state);
    expect(npc.bubbleText).toBe("hi");
  });

  it("clears bubble when durationTicks is 0", () => {
    const state = buildState();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.setBubble("prior", 10, 0);
    state.agents.set(npc.id, npc);
    applyEventEffects([bubble("n1", "", { durationTicks: 0 })], state);
    expect(npc.bubbleText).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/event-dispatch.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/src/simulation/event-dispatch.ts`**

```ts
import type { EventEffect, NpcEventMap, NpcEventName } from "@town-zero/shared/script-dsl";
import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";

export function dispatch<K extends NpcEventName>(
  agent: Agent,
  event: K,
  payload: NpcEventMap[K],
): EventEffect[] {
  const handlers = agent.eventHandlers.get(event);
  if (!handlers || handlers.length === 0) return [];
  const snapshot = [...handlers];
  const out: EventEffect[] = [];
  for (let i = 0; i < snapshot.length; i++) {
    try {
      const effects = snapshot[i](payload as unknown);
      if (effects.length > 0) out.push(...effects);
    } catch (err) {
      console.error(`[event-dispatch] ${agent.id} ${event} handler ${i} threw:`, err);
    }
  }
  return out;
}

export function applyEventEffects(effects: EventEffect[], state: SimulationState): void {
  // `EventEffect` is deliberately narrow (bubble-only in MVP). The switch is
  // exhaustive — broader effects (set_fact / damage / give etc.) live in the
  // shared `Effect` union and are emitted by script-level triggers, which go
  // through the dialogue executor instead of this path.
  for (const effect of effects) {
    switch (effect.type) {
      case "bubble": {
        const target = state.agents.get(effect.target);
        if (!target) break;
        target.setBubble(effect.text, effect.durationTicks, state.tick);
        break;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/event-dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/event-dispatch.ts server/test/simulation/event-dispatch.test.ts
git commit -m "feat(events): add dispatch() + applyEventEffects()"
```

---

## Task 7: Scenario-loader registers handlers on agents

**Files:**
- Modify: `server/src/simulation/scenario-loader.ts`
- Test: `server/test/simulation/scenario-loader.test.ts`

- [ ] **Step 1: Write failing test**

Extend `server/test/simulation/scenario-loader.test.ts`:

```ts
import { scenario, bubble } from "@town-zero/shared/script-dsl";

describe("loadScenario — handler registration", () => {
  it("registers NPC .on() handlers into agent.eventHandlers", () => {
    const state: SimulationState = {
      grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
      nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
    };
    const data = scenario("s1", (s) => {
      s.npc("n1", { role: "villager", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] })
        .on("proximity:enter", ({ self }) => [bubble(self.id, "hi", { durationTicks: 5 })])
        .on("talk:start",      () => []);
    });
    loadScenario(data, state);
    const agent = state.agents.get("n1")!;
    expect(agent.eventHandlers.get("proximity:enter")).toHaveLength(1);
    expect(agent.eventHandlers.get("talk:start")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/scenario-loader.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `server/src/simulation/scenario-loader.ts`**

After `state.agents.set(npcDef.id, agent);`, add:

```ts
    if (npcDef.handlers) {
      for (const { event, handler } of npcDef.handlers) {
        const list = agent.eventHandlers.get(event) ?? [];
        list.push(handler);
        agent.eventHandlers.set(event, list);
      }
    }
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/scenario-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/scenario-loader.ts server/test/simulation/scenario-loader.test.ts
git commit -m "feat(events): loadScenario registers NPC handlers"
```

---

## Task 8: Tick Phase 6b — proximity diff + event dispatch

**Files:**
- Modify: `server/src/simulation/tick.ts`
- Test: `server/test/simulation/proximity-events.test.ts`
- Test: `server/test/simulation/bubble.test.ts` (prune stale tests)

- [ ] **Step 1: Write failing proximity-events test**

Create `server/test/simulation/proximity-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { processTick, type SimulationState } from "../../src/simulation/tick.js";
import type { EventHandler, ProximityEnterPayload, ProximityStayPayload, ProximityLeavePayload } from "@town-zero/shared/script-dsl";

function buildWorld(): SimulationState {
  return {
    grid: new Grid(20, 20), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("Phase 6b — proximity event dispatch", () => {
  it("fires proximity:enter on the first tick a player is in range", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const seen: string[] = [];
    const h: EventHandler<ProximityEnterPayload> = ({ player }) => { seen.push(`enter:${player.id}`); return []; };
    npc.eventHandlers.set("proximity:enter", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    expect(seen).toEqual(["enter:p1"]);
  });

  it("fires proximity:stay on subsequent ticks with monotonic ticksInRange", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const stays: number[] = [];
    const h: EventHandler<ProximityStayPayload> = ({ ticksInRange }) => { stays.push(ticksInRange); return []; };
    npc.eventHandlers.set("proximity:stay", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world); // enter only
    processTick(world);
    processTick(world);
    expect(stays).toEqual([1, 2]);
  });

  it("fires proximity:leave exactly once when player drops out of range", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const leaves: string[] = [];
    const h: EventHandler<ProximityLeavePayload> = ({ player }) => { leaves.push(player.id); return []; };
    npc.eventHandlers.set("proximity:leave", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);                            // enter
    player.position = { x: 19, y: 19 };            // well outside vision
    processTick(world);                            // leave
    processTick(world);                            // no more leaves
    expect(leaves).toEqual(["p1"]);
    expect(npc.proximityState.has("p1")).toBe(false);
  });

  it("re-enter resets ticksInRange to 1", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const stays: number[] = [];
    npc.eventHandlers.set("proximity:stay", [((p: any) => { stays.push(p.ticksInRange); return []; }) as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);                            // enter
    processTick(world);                            // stay=1
    player.position = { x: 19, y: 19 };
    processTick(world);                            // leave
    player.position = { x: 6, y: 5 };
    processTick(world);                            // enter (again)
    processTick(world);                            // stay=1 again
    expect(stays).toEqual([1, 1]);
  });

  it("symmetry: enter fires whether NPC moves into range or player does", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const enters: string[] = [];
    npc.eventHandlers.set("proximity:enter", [((p: any) => { enters.push(p.player.id); return []; }) as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 19, y: 19 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);                            // no enter
    npc.position = { x: 18, y: 19 };               // NPC moves next to player
    processTick(world);                            // enter by NPC-move
    expect(enters).toEqual(["p1"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (old tick path still runs; no dispatch)**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/proximity-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Replace tick.ts Phase 6b**

In `server/src/simulation/tick.ts`:

Add imports:

```ts
import { dispatch, applyEventEffects } from "./event-dispatch.js";
```

Remove the current `// Phase 6b: Bubble upkeep (expiry + proximity triggers)` block (the `alivePlayers` precompute + proximity cooldown loop). Replace with:

```ts
  // Phase 6b: Bubble expiry + event dispatch.
  for (const [, agent] of agents) {
    // Expiry runs for dead agents too — a bubble active at the moment of
    // death would otherwise stay synced to clients forever.
    if (agent.bubbleText !== null && tick >= agent.bubbleExpiresAt) {
      agent.setBubble("", 0, tick);
    }
  }

  // Proximity diff + dispatch.
  const alivePlayers: Array<{ agent: Agent; radius: number }> = [];
  for (const [, other] of agents) {
    if (other.controller !== "player" || !other.isAlive()) continue;
    alivePlayers.push({ agent: other, radius: getVisionRadius(other) });
  }

  for (const [, npc] of agents) {
    if (!npc.isAlive()) continue;
    if (npc.controller === "player") continue; // only NPCs get proximity events
    if (npc.eventHandlers.size === 0) continue; // short-circuit if no handlers

    const selfRef = {
      id: npc.id, faction: npc.faction, role: npc.role, position: { ...npc.position },
    };

    const currentInRange = new Map<string, number>(); // playerId → distance
    for (const { agent: p, radius } of alivePlayers) {
      const dx = Math.abs(p.position.x - npc.position.x);
      const dy = Math.abs(p.position.y - npc.position.y);
      const dist = dx + dy;
      if (dist <= radius) currentInRange.set(p.id, dist);
    }

    // Diff against previous tick's proximityState.
    for (const [pid, dist] of currentInRange) {
      const playerAgent = agents.get(pid)!;
      const playerRef = {
        id: playerAgent.id, faction: playerAgent.faction, role: playerAgent.role,
        position: { ...playerAgent.position },
      };
      const prevTicks = npc.proximityState.get(pid);
      if (prevTicks === undefined) {
        const effs = dispatch(npc, "proximity:enter", {
          tick, self: selfRef, player: playerRef, distance: dist,
        });
        applyEventEffects(effs, state);
        npc.proximityState.set(pid, 1);
      } else {
        const effs = dispatch(npc, "proximity:stay", {
          tick, self: selfRef, player: playerRef, distance: dist, ticksInRange: prevTicks,
        });
        applyEventEffects(effs, state);
        npc.proximityState.set(pid, prevTicks + 1);
      }
    }

    // Leaves: anyone in proximityState but not currentInRange.
    for (const pid of [...npc.proximityState.keys()]) {
      if (currentInRange.has(pid)) continue;
      const playerAgent = agents.get(pid);
      // Player may have been removed; synthesize a minimal ref if so.
      const playerRef = playerAgent
        ? { id: playerAgent.id, faction: playerAgent.faction, role: playerAgent.role, position: { ...playerAgent.position } }
        : { id: pid, faction: "player", role: "player", position: { x: -1, y: -1 } };
      const effs = dispatch(npc, "proximity:leave", { tick, self: selfRef, player: playerRef });
      applyEventEffects(effs, state);
      npc.proximityState.delete(pid);
    }
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/proximity-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Prune stale tests in `server/test/simulation/bubble.test.ts`**

Remove the `describe("Agent.proximityBubble", ...)` block (API deleted) and the `processTick — bubble upkeep` tests that reference `proximityBubble` / `getLastProximityTrigger` / `recordProximityTrigger`. Keep:
- `describe("Agent.setBubble", ...)` (still valid)
- `it("clears bubble when bubbleExpiresAt is reached", ...)` (still valid)
- `it("clears an active bubble when the NPC dies before expiry", ...)` (still valid)

- [ ] **Step 6: Run full server tests**

Run: `pnpm --filter @town-zero/server run test`
Expected: all other tests pass (save Task 9/10/11 pending ones).

- [ ] **Step 7: Commit**

```bash
git add server/src/simulation/tick.ts server/test/simulation/proximity-events.test.ts server/test/simulation/bubble.test.ts
git commit -m "feat(events): tick Phase 6b dispatches proximity enter/stay/leave"
```

---

## Task 9: session-manager dispatches `talk:start` / `talk:end`

**Files:**
- Modify: `server/src/dialogue/session-manager.ts`
- Modify: `server/src/rooms/GameRoom.ts` (call sites for endDialogue reason)
- Test: `server/test/dialogue/talk-events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/test/dialogue/talk-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { startDialogue, endDialogue, tickDialogues } from "../../src/dialogue/session-manager.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EventHandler, TalkStartPayload, TalkEndPayload } from "@town-zero/shared/script-dsl";
import type { DialogueTreeData } from "@town-zero/shared";

function trivialTree(npcId: string): DialogueTreeData {
  return { id: "d1", root: "n1", nodes: { n1: { type: "text", speaker: "npc", content: ["hi"], next: "n2" }, n2: { type: "end" } }, triggers: [] };
}

function buildState(npcId: string): SimulationState {
  const state: SimulationState = {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(),
    dialogueTrees: new Map([["d1", trivialTree(npcId)]]),
  };
  return state;
}

describe("session-manager — talk events", () => {
  it("dispatches talk:start on successful startDialogue", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    (npc as any).dialogueIds = ["d1"];
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc);
    state.agents.set("p1", player);

    const events: TalkStartPayload[] = [];
    const h: EventHandler<TalkStartPayload> = (p) => { events.push(p); return []; };
    npc.eventHandlers.set("talk:start", [h as EventHandler<unknown>]);
    // Seed dialogue tree lookup
    (state as any).agents.get("n1").dialogueIds = ["d1"];

    startDialogue("p1", "n1", state);
    expect(events).toHaveLength(1);
    expect(events[0].dialogueId).toBe("d1");
    expect(events[0].player.id).toBe("p1");
  });

  it("dispatches talk:end with reason=\"timeout\" on tickDialogues expiry", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc); state.agents.set("p1", player);
    const ends: TalkEndPayload[] = [];
    npc.eventHandlers.set("talk:end", [((p: TalkEndPayload) => { ends.push(p); return []; }) as EventHandler<unknown>]);

    startDialogue("p1", "n1", state);
    state.tick += 10_000;
    tickDialogues(state);
    expect(ends).toHaveLength(1);
    expect(ends[0].reason).toBe("timeout");
  });

  it("dispatches talk:end with reason=\"player_left\" when endDialogue called with that reason", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc); state.agents.set("p1", player);
    const ends: TalkEndPayload[] = [];
    npc.eventHandlers.set("talk:end", [((p: TalkEndPayload) => { ends.push(p); return []; }) as EventHandler<unknown>]);

    startDialogue("p1", "n1", state);
    endDialogue("n1", state, "player_left");
    expect(ends).toHaveLength(1);
    expect(ends[0].reason).toBe("player_left");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @town-zero/server exec vitest run test/dialogue/talk-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change `endDialogue` signature + dispatch sites in `server/src/dialogue/session-manager.ts`**

Add imports:

```ts
import { dispatch, applyEventEffects } from "../simulation/event-dispatch.js";
import type { TalkEndPayload } from "@town-zero/shared/script-dsl";
```

Change `endDialogue` signature:

```ts
export function endDialogue(
  npcId: string,
  state: SimulationState,
  reason: TalkEndPayload["reason"],
): void {
  const session = state.activeSessions.get(npcId);
  if (!session) return;
  const npc = state.agents.get(npcId);
  const player = state.agents.get(session.playerId);
  if (npc && player) {
    const selfRef = { id: npc.id, faction: npc.faction, role: npc.role, position: { ...npc.position } };
    const playerRef = { id: player.id, faction: player.faction, role: player.role, position: { ...player.position } };
    const effs = dispatch(npc, "talk:end", { tick: state.tick, self: selfRef, player: playerRef, reason });
    applyEventEffects(effs, state);
  }
  session.dispose();
  state.activeSessions.delete(npcId);
}
```

In `startDialogue`, **remove** the hardcoded `target.setBubble("", 0, state.tick);` line. Replace with `talk:start` dispatch immediately after locks are set (before `buildPayload`):

```ts
  // Dispatch talk:start (handlers may clear the bubble via a bubble() effect).
  {
    const selfRef = { id: target.id, faction: target.faction, role: target.role, position: { ...target.position } };
    const playerRef = { id: player.id, faction: player.faction, role: player.role, position: { ...player.position } };
    const effs = dispatch(target, "talk:start", {
      tick: state.tick, self: selfRef, player: playerRef, dialogueId: treeId,
    });
    applyEventEffects(effs, state);
  }
```

In `tickDialogues`, change `endDialogue(npcId, state)` → `endDialogue(npcId, state, "timeout")`.

- [ ] **Step 4: Update call sites in `advanceDialogue` / `chooseDialogue` end branches**

They already call `endDialogue(npcId, state)` — update to pass `"completed"` explicitly: `endDialogue(npcId, state, "completed")`. `reason` is required (no default) so non-completion end paths can't be mislabeled.

- [ ] **Step 5: Update `GameRoom.ts` call sites**

`onMessage("dialogue:close")` → `endDialogue(agent.talkingToNpcId, this.simState, "player_left")`.
`onLeave` when agent mid-dialogue → `endDialogue(agent.talkingToNpcId, this.simState, "player_left")`.

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/dialogue/talk-events.test.ts`
Expected: PASS.

- [ ] **Step 7: Full server test — expect PASS**

Run: `pnpm --filter @town-zero/server run test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/dialogue/session-manager.ts server/src/rooms/GameRoom.ts server/test/dialogue/talk-events.test.ts
git commit -m "feat(events): dispatch talk:start and talk:end"
```

---

## Task 10: `combat:hit` + `combat:death` via `applyDamage` helper

**Files:**
- Create: `server/src/simulation/apply-damage.ts`
- Modify: `server/src/simulation/facing-actions.ts`
- Modify: `server/src/dialogue/executor.ts`
- Test: `server/test/simulation/combat-events.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/test/simulation/combat-events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { applyDamage } from "../../src/simulation/apply-damage.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EventHandler, CombatHitPayload, CombatDeathPayload } from "@town-zero/shared/script-dsl";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("applyDamage", () => {
  it("fires combat:hit with attacker, damage, hpAfter", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const hits: CombatHitPayload[] = [];
    victim.eventHandlers.set("combat:hit", [((p: CombatHitPayload) => { hits.push(p); return []; }) as EventHandler<unknown>]);

    applyDamage(victim, 10, attacker, state);
    expect(hits).toHaveLength(1);
    expect(hits[0].attacker.id).toBe("a1");
    expect(hits[0].damage).toBe(10);
    expect(hits[0].hpAfter).toBe(victim.hp);
  });

  it("fires combat:death only on killing blow and strictly after combat:hit", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const seq: string[] = [];
    victim.eventHandlers.set("combat:hit", [((p: CombatHitPayload) => { seq.push(`hit:${p.hpAfter}`); return []; }) as EventHandler<unknown>]);
    victim.eventHandlers.set("combat:death", [((p: CombatDeathPayload) => { seq.push(`death:${p.killer?.id ?? "null"}`); return []; }) as EventHandler<unknown>]);

    applyDamage(victim, victim.hp, attacker, state);
    expect(seq).toEqual(["hit:0", "death:a1"]);
  });

  it("does not fire combat:death on non-lethal hits", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const deaths: string[] = [];
    victim.eventHandlers.set("combat:death", [((p: CombatDeathPayload) => { deaths.push(p.killer?.id ?? "null"); return []; }) as EventHandler<unknown>]);
    applyDamage(victim, 1, attacker, state);
    expect(deaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/combat-events.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/src/simulation/apply-damage.ts`**

```ts
import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";
import { dispatch, applyEventEffects } from "./event-dispatch.js";

export function applyDamage(
  target: Agent,
  amount: number,
  attacker: Agent | null,
  state: SimulationState,
): void {
  if (!target.isAlive()) return;
  target.takeDamage(amount);

  const selfRef = { id: target.id, faction: target.faction, role: target.role, position: { ...target.position } };
  const attackerRef = attacker
    ? { id: attacker.id, faction: attacker.faction, role: attacker.role, position: { ...attacker.position } }
    : null;

  if (attackerRef) {
    const hitEffs = dispatch(target, "combat:hit", {
      tick: state.tick, self: selfRef, attacker: attackerRef, damage: amount, hpAfter: target.hp,
    });
    applyEventEffects(hitEffs, state);
  }

  if (!target.isAlive()) {
    const deathEffs = dispatch(target, "combat:death", {
      tick: state.tick, self: selfRef, killer: attackerRef,
    });
    applyEventEffects(deathEffs, state);
  }
}
```

- [ ] **Step 4: Route `performAttackOnFacingTarget` through `applyDamage`**

In `server/src/simulation/facing-actions.ts`, replace `target.takeDamage(BASE_ATTACK_DAMAGE);` with:

```ts
  if (!ctx.simState) { target.takeDamage(BASE_ATTACK_DAMAGE); return; }
  applyDamage(target, BASE_ATTACK_DAMAGE, agent, ctx.simState);
```

Add import: `import { applyDamage } from "./apply-damage.js";`

- [ ] **Step 5: Route `damage` Effect through `applyDamage`**

In `server/src/dialogue/executor.ts`, inject an optional `state` on `MutableContext` and a ref-resolver. Simpler approach — leave executor as-is for now; trigger-driven damage predates events and rarely fires in v1. Document as known debt. (If tests require, add the wiring.)

Add to CLAUDE.md TODO: _"Wire `applyDamage` into `executor.damage` so trigger-fired damage also emits `combat:hit/:death`."_ — this tracks the follow-up.

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm --filter @town-zero/server exec vitest run test/simulation/combat-events.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/simulation/apply-damage.ts server/src/simulation/facing-actions.ts server/test/simulation/combat-events.test.ts
git commit -m "feat(events): applyDamage dispatches combat:hit then combat:death"
```

---

## Task 11: Rename proximity-cleanup → proximity-state-cleanup

**Files:**
- Create: `server/src/rooms/proximity-state-cleanup.ts`
- Delete: `server/src/rooms/proximity-cleanup.ts`
- Modify: `server/src/rooms/GameRoom.ts`
- Create: `server/test/rooms/on-leave-proximity-state.test.ts`
- Delete: `server/test/rooms/on-leave-proximity.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/test/rooms/on-leave-proximity-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { TriggerRegistry } from "../../src/dialogue/trigger-registry.js";
import { purgeProximityState } from "../../src/rooms/proximity-state-cleanup.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, triggerRegistry: new TriggerRegistry(),
    activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("purgeProximityState", () => {
  it("removes the target player id from every alive NPC's proximityState", () => {
    const state = buildState();
    const n1 = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    const n2 = new Agent({ id: "n2", position: { x: 1, y: 0 }, faction: "village", role: "villager", controller: "bot" });
    n1.proximityState.set("p1", 3);
    n1.proximityState.set("p2", 5);
    n2.proximityState.set("p1", 2);
    state.agents.set("n1", n1); state.agents.set("n2", n2);

    purgeProximityState(state, "p1");

    expect(n1.proximityState.has("p1")).toBe(false);
    expect(n2.proximityState.has("p1")).toBe(false);
    expect(n1.proximityState.get("p2")).toBe(5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @town-zero/server exec vitest run test/rooms/on-leave-proximity-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `server/src/rooms/proximity-state-cleanup.ts`**

```ts
import type { SimulationState } from "../simulation/tick.js";

/**
 * Remove the given player id from every alive NPC's proximityState map on
 * disconnect. Called from GameRoom.onLeave. Ensures a reconnecting player
 * re-fires proximity:enter instead of inheriting stale ticksInRange.
 */
export function purgeProximityState(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    if (!agent.isAlive()) continue;
    agent.proximityState.delete(playerId);
  }
}
```

- [ ] **Step 4: Update `GameRoom.ts`**

Replace `import { purgeProximityLedger } from "./proximity-cleanup.js";` with `import { purgeProximityState } from "./proximity-state-cleanup.js";`. Replace the call in `onLeave` accordingly.

- [ ] **Step 5: Delete old files**

```bash
git rm server/src/rooms/proximity-cleanup.ts
git rm server/test/rooms/on-leave-proximity.test.ts
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `pnpm --filter @town-zero/server run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/rooms/proximity-state-cleanup.ts server/src/rooms/GameRoom.ts server/test/rooms/on-leave-proximity-state.test.ts
git commit -m "refactor(events): rename proximity-cleanup → proximity-state-cleanup"
```

---

## Task 12: Migrate Farmer Reed scenario to `.on()`

**Files:**
- Modify: `server/src/scenarios/farmer-reed.ts`
- Modify: `server/test/integration-farmer-reed.test.ts` (verify still passes)

- [ ] **Step 1: Update scenario**

In `server/src/scenarios/farmer-reed.ts`, replace the `s.npc("farmer-reed", { ... proximityBubble: { ... } })` call with:

```ts
  s.npc("farmer-reed", {
    name: "Farmer Reed",
    role: "farmer",
    faction: "village-1",
    position: { x: 9, y: 19 },
    initialBeliefs: [],
  })
  .on("proximity:enter", ({ self }) => [
    bubble(self.id, "Greetings, traveler!", { durationTicks: 40 }),
  ])
  .on("talk:start", ({ self }) => [
    bubble(self.id, "", { durationTicks: 0 }),
  ]);
```

Add `bubble` to the existing `@town-zero/shared/script-dsl` import.

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @town-zero/server exec vitest run test/integration-farmer-reed.test.ts`
Expected: PASS (observable behaviour unchanged).

- [ ] **Step 3: Full build + test**

Run: `pnpm run build && pnpm --filter @town-zero/server run test`
Expected: PASS across the board.

- [ ] **Step 4: Commit**

```bash
git add server/src/scenarios/farmer-reed.ts
git commit -m "refactor(scenario): farmer-reed uses .on() event handlers"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite the "NPC bubble channel" paragraph**

Replace with:

```
- **NPC event system:** NPCs expose typed events via `s.npc(id).on(event, handler)`. Event map: `proximity:{enter,stay,leave}`, `talk:{start,end}`, `combat:{hit,death}` (see `shared/src/script-dsl/event-types.ts`). Handlers return `EventEffect[]` — a narrow standalone type (`{ type: "bubble"; target: AgentRef; text: string; durationTicks: number }`, bubble-only in MVP). `setFact` / `give` / `damage` / etc. live in the shared `Effect` union and are intentionally **not** part of `EventEffect`; emitting them from a handler is a compile-time error, and scenarios that need them must route through script-level triggers. Multiple handlers per event compose via `flatMap` in registration order. A throwing handler is isolated (logged, others still run). Dispatch is snapshot-at-dispatch: a handler that registers more handlers mid-dispatch does not observe them this tick. `bubble(target, text, { durationTicks })` sets / clears the NPC speech bubble (special refs `$npc` / `$self` / `$player` resolved against the payload). Event dispatch is independent of the dialogue input-lock: a locked NPC still receives events and its handlers still run.
```

- [ ] **Step 2: Remove stale TODO / cleanup**

Remove any leftover `proximityBubble` / `proximityLedger` references. Add a line to the known-debt/TODO section:

```
- **Trigger-fired damage bypasses combat events.** `server/src/dialogue/executor.ts` calls `Agent.takeDamage` directly; route through `applyDamage` so `combat:hit` / `combat:death` fire for damage dealt by scripted triggers.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe NPC event system in CLAUDE.md"
```

---

## Task 14: Final verification + PR

- [ ] **Step 1: Full build + test suite**

Run: `pnpm run build && pnpm --filter @town-zero/server run test`
Expected: green across `shared/`, `server/`, `client/`.

- [ ] **Step 2: Integration check — dev server boots without errors**

Run: `pnpm run dev:server` in one terminal, `pnpm run dev:client` in another. Connect a browser, confirm:
- Walking past Farmer Reed triggers the greeting bubble (proximity:enter handler).
- Pressing E to talk clears the bubble (talk:start handler).
- Leaving range re-arms proximity:enter (after reconnect or range exit + re-entry).

- [ ] **Step 3: Open PR**

After local review:

```bash
git push -u origin feat/event-system
gh pr create --title "feat(events): typed event system for NPCs" --body "$(cat <<'EOF'
## Summary
- Replaces hard-wired `proximityBubble` config with a typed, composable event system (`s.npc().on(event, handler)`).
- Event map covers proximity/talk/combat; handlers return `EventEffect[]` (bubble-only in MVP) composed via `flatMap`. Non-bubble effects are a compile-time error — script-level triggers remain the path for broader effect emission.
- New standalone `EventEffect` type (not a member of the general `Effect` union) lets handlers set/clear NPC speech bubbles without making bubble legal in dialogue/trigger effects.
- Removes `ProximityBubbleConfig`, `proximityLedger`, and the old Phase 6b cooldown loop.

## Test plan
- [x] `event-dispatch.test.ts` — composition, error isolation, snapshot-at-dispatch
- [x] `proximity-events.test.ts` — enter/stay/leave + symmetry + reconnect re-fire
- [x] `talk-events.test.ts` — start + end reasons
- [x] `combat-events.test.ts` — hit payload + hit-before-death ordering
- [x] `event-builder.test.ts` — `.on()` chaining + tsc overload match
- [x] Integration: Farmer Reed greets and clears bubble on talk, end-to-end

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Hand off to finishing-a-development-branch**

REQUIRED SUB-SKILL: Use `superpowers:finishing-a-development-branch` to verify + land the branch.
