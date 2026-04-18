# Combat-as-Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the combat `attack` action into a unified server-side `interact` verb that dispatches by facing tile, and add a decoupled NPC dialog-bubble channel with proximity-trigger as the v1 source.

**Architecture:**
- Client sends a single `{ type: "interact" }` action frame when the player presses the interact key. The server's `dispatchInteract` inspects the agent's facing tile and routes to `attack` / `talk` / `gather` via existing sub-handlers. Attack tightens to facing-only, closing the existing KeyQ debt. Trade keeps its client-local modal short-circuit.
- The dialog-bubble channel is an independent output on NPCs. `Agent.setBubble(text, ticks)` sets a synced `bubbleText` field. In v1 it is driven by an optional `proximityBubble` config (fires once per player entering NPC vision, with cooldown) and cleared on dialogue start. All other sources (trigger-rule effects, LLM chatter) are deferred.

**Tech Stack:** TypeScript (strict, ES2022), Node.js via tsx, Colyseus 0.17 + `@colyseus/schema` 4.x, Vitest. Monorepo with pnpm workspaces (`shared/`, `server/`, `client/`).

**Spec:** `docs/superpowers/specs/001-combat-as-interaction-design.md`

**Dependency specs:**
- `docs/superpowers/specs/2026-04-04-facing-npc-dialogue-design.md` — facing + dialogue entryPoint model
- `docs/superpowers/specs/2026-04-05-unified-input-frame-design.md` — InputFrame + reconciliation

---

## File Structure

### Created files

| File | Responsibility |
|------|----------------|
| `server/src/simulation/dialogue-entry-predicate.ts` | Pure side-effect-free predicate `hasMatchingDialogueEntry(player, target, state)` used by `dispatchInteract` rule 2. Reuses `EvalContext` builder. |
| `server/src/simulation/dispatch-interact.ts` | Server-side `dispatchInteract(ctx)` implementing the 6-rule priority on the agent's facing tile. |
| `server/test/simulation/dialogue-entry-predicate.test.ts` | Unit tests for the predicate. |
| `server/test/simulation/dispatch-interact.test.ts` | Unit tests covering each dispatch priority branch. |
| `server/test/simulation/bubble.test.ts` | Unit tests for `setBubble`, expiry, proximity trigger, ledger cleanup. |

### Modified files

| File | Change |
|------|--------|
| `shared/src/types.ts` | Add `{ type: "interact" }` to `FrameAction` union. |
| `server/src/rooms/validation.ts` | Add `"interact"` case to `isValidAction`. |
| `server/src/simulation/execute-frame.ts` | Add `case "interact"`; tighten `attack` to `isFacingTile`. |
| `server/src/simulation/agent.ts` | Add `bubbleText`, `bubbleExpiresAt`, `setBubble()`, `proximityBubble` config, `proximityLedger`, and ledger-removal helpers. |
| `server/src/simulation/tick.ts` | New sub-phase: bubble expiry sweep + proximity-trigger pass. |
| `server/src/rooms/schemas/AgentSchema.ts` | Add `bubbleText: "string"` field. |
| `server/src/rooms/sync.ts` | Sync `bubbleText`. |
| `server/src/rooms/GameRoom.ts` | On player disconnect, purge the player's entry from every NPC's `proximityLedger`. |
| `server/src/dialogue/session-manager.ts` | On `startDialogue` success, call `target.setBubble("", 0)` and extract the entry-point evaluation into the new predicate module (reuse, don't duplicate). |
| `server/test/simulation/execute-frame.test.ts` | Extend with facing-only attack tests (player + LLM) and the `interact` case. |
| `client/src/input.ts` | Remove `KeyQ` branch; `handleInteract` sends `{ type: "interact" }`. Merchant detection keeps the client-local modal short-circuit. Update `ACTION_CODES` and HUD hint text. |
| `client/src/renderer.ts` | Render NPC `bubbleText` above sprite when present and agent is visible through fog. |
| `client/src/types.ts` | Add `bubbleText?: string` to any local agent snapshot type. |
| `CLAUDE.md` | Remove the facing-only-attack TODO/debt lines; rewrite the "Facing-based interaction" paragraph; add a note describing the bubble channel. |

---

## Notes for the implementer

1. **Schema is broadcast, not per-client filtered.** Per `CLAUDE.md` and the code in `server/src/rooms/sync.ts`, every client receives the full `AgentSchema` map. Fog of war is enforced client-side (`client/src/fog.ts`). The bubble therefore syncs to all clients but must only be *rendered* for agents the client's fog deems visible. The spec's "inherits fog filter automatically" is accurate for the rendering outcome, not the transport layer.
2. **Trade modal stays client-local (Option A).** The client detects a merchant on the facing tile before calling `handleInteract`; if one is present, it opens the modal and returns *without* sending an `interact` frame. This preserves existing UX and avoids a server round-trip for a UI transition.
3. **Do not invoke `startDialogue` speculatively from the dispatcher.** It mutates facing and locks agents. Use the pure predicate. Only call `startDialogue` *after* rule 2 commits.
4. **All commits go on a feature branch** (`feat/combat-as-interaction`). User rule: implementation commits never go to `main` directly.
5. **TDD throughout.** Write failing tests, verify red, implement minimum, verify green, commit. Use `@superpowers:test-driven-development`.

Before starting Task 1, create the branch:

```bash
git checkout -b feat/combat-as-interaction
```

---

## Task 1: Add `interact` variant to `FrameAction` + validation

**Files:**
- Modify: `shared/src/types.ts` (FrameAction union, ~line 45-52)
- Modify: `server/src/rooms/validation.ts` (`isValidAction`, ~line 21-37)

- [ ] **Step 1: Write the failing validation test**

Create or open `server/test/rooms/validation.test.ts`. If the file does not exist, create it.

```ts
import { describe, it, expect } from "vitest";
import { isValidInputFrame } from "../../src/rooms/validation.js";

describe("isValidInputFrame — interact", () => {
  it("accepts an interact action frame", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "interact" } })).toBe(true);
  });

  it("still accepts existing action shapes", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "attack", targetId: "a" } })).toBe(true);
  });

  it("rejects unknown action types", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "teleport" } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test; verify `interact` test fails**

```bash
pnpm --filter @town-zero/server test -- validation
```

Expected: the interact case fails (validator rejects unknown type).

- [ ] **Step 3: Add `interact` variant to `FrameAction`**

In `shared/src/types.ts`:

```ts
export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "talk"; targetId: string }
  | { type: "interact" }
  | { type: "idle" };
```

- [ ] **Step 4: Add validation case**

In `server/src/rooms/validation.ts`, add inside the `switch (a.type)` block in `isValidAction` before `default`:

```ts
case "interact": return true;
```

- [ ] **Step 5: Rebuild shared + run tests; verify green**

```bash
pnpm run build
pnpm --filter @town-zero/server test -- validation
```

Expected: all three cases pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src/types.ts server/src/rooms/validation.ts server/test/rooms/validation.test.ts
git commit -m "feat(shared): add interact FrameAction variant + validation"
```

---

## Task 2: Extract pure dialogue-entry predicate

**Files:**
- Create: `server/src/simulation/dialogue-entry-predicate.ts`
- Create: `server/test/simulation/dialogue-entry-predicate.test.ts`
- Modify: `server/src/dialogue/session-manager.ts` (`startDialogue`, ~lines 98-138) — replace inline evaluation with a call to the new predicate.

The existing logic in `startDialogue` (finding the tree for an NPC, building `EvalContext`, iterating `entryPoints`) is inlined. Extract it so both `startDialogue` and the new `dispatchInteract` can share it.

- [ ] **Step 1: Write the failing test**

```ts
// server/test/simulation/dialogue-entry-predicate.test.ts
import { describe, it, expect } from "vitest";
import { hasMatchingDialogueEntry, resolveDialogueEntryNode } from "../../src/simulation/dialogue-entry-predicate.js";
import { Agent } from "../../src/simulation/agent.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { DialogueTreeData } from "@town-zero/shared";

function buildState(tree: DialogueTreeData, npc: Agent, player: Agent, tick = 0): SimulationState {
  return {
    grid: {} as any,
    agents: new Map([[npc.id, npc], [player.id, player]]),
    settlements: new Map(),
    tick,
    nextMerchantId: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map([[`${npc.id}-tree`, tree]]),
  };
}

describe("hasMatchingDialogueEntry", () => {
  it("returns false when the NPC has no dialogue tree", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f1", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "f2", role: "player", controller: "player" });
    const state: SimulationState = {
      grid: {} as any, agents: new Map([[npc.id, npc], [player.id, player]]),
      settlements: new Map(), tick: 0, nextMerchantId: 0,
      activeSessions: new Map(), dialogueTrees: new Map(),
    };
    expect(hasMatchingDialogueEntry(player, npc, state)).toBe(false);
  });

  it("returns true when tree has only a root and no entryPoints (same-faction path still yields root match)", () => {
    // Per spec §1.2 entry-less fallback: entry-less trees do NOT match rule 2;
    // rule 4 for same-faction → noop; rule 3 for cross-faction → attack.
    // The predicate therefore returns false for entry-less trees.
    const tree: DialogueTreeData = { id: "n1-tree", root: "start", nodes: { start: { id: "start", type: "text", text: "hi" } } } as any;
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f1", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "f1", role: "player", controller: "player" });
    const state = buildState(tree, npc, player);
    expect(hasMatchingDialogueEntry(player, npc, state)).toBe(false);
  });

  it("returns true when at least one entryPoint condition evaluates true", () => {
    const tree: DialogueTreeData = {
      id: "n1-tree",
      root: "default",
      nodes: { default: { id: "default", type: "text", text: "hi" }, surrender: { id: "surrender", type: "text", text: "I surrender" } },
      entryPoints: [
        { condition: { op: "eq", left: { kind: "belief", key: "wants_parley" }, right: { kind: "literal", value: true } }, nodeId: "surrender" },
      ],
    } as any;
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f1", role: "villager", controller: "bot" });
    npc.setBelief("wants_parley", { value: true, tick: 0 });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "f2", role: "player", controller: "player" });
    const state = buildState(tree, npc, player);
    expect(hasMatchingDialogueEntry(player, npc, state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test; verify red**

```bash
pnpm --filter @town-zero/server test -- dialogue-entry-predicate
```

Expected: FAIL — module missing.

- [ ] **Step 3: Create the predicate module**

```ts
// server/src/simulation/dialogue-entry-predicate.ts
import type { Agent } from "./agent.js";
import type { SimulationState } from "./tick.js";
import { checkCondition, type EvalContext } from "../dialogue/evaluator.js";

function findTreeIdForNpc(npcId: string, state: SimulationState): string | null {
  for (const [id] of state.dialogueTrees) {
    if (id.startsWith(npcId)) return id;
  }
  for (const [id] of state.dialogueTrees) {
    if (id.includes(npcId)) return id;
  }
  return null;
}

function buildEvalContext(player: Agent, npc: Agent, state: SimulationState): EvalContext {
  return {
    beliefs: npc.getAllBeliefs(),
    locals: new Map(),
    agentState: {
      player: { get: (p: string) => {
        if (p === "hp") return player.hp;
        if (p === "id") return player.id;
        if (p === "role") return player.role;
        if (p === "faction") return player.faction;
        if (p === "x") return player.position.x;
        if (p === "y") return player.position.y;
        const inv = player.inventory;
        if (p in inv) return inv[p as keyof typeof inv];
        return 0;
      }},
      npc: { get: (p: string) => {
        if (p === "hp") return npc.hp;
        if (p === "id") return npc.id;
        if (p === "role") return npc.role;
        if (p === "faction") return npc.faction;
        if (p === "x") return npc.position.x;
        if (p === "y") return npc.position.y;
        const inv = npc.inventory;
        if (p in inv) return inv[p as keyof typeof inv];
        return 0;
      }},
      settlement: null,
    },
    currentTick: state.tick,
  };
}

/** Side-effect-free: evaluates entryPoints only. Returns the matching nodeId, or null. */
export function resolveDialogueEntryNode(player: Agent, npc: Agent, state: SimulationState): string | null {
  const treeId = findTreeIdForNpc(npc.id, state);
  if (!treeId) return null;
  const tree = state.dialogueTrees.get(treeId)!;
  if (!tree.entryPoints || tree.entryPoints.length === 0) return null;

  const ctx = buildEvalContext(player, npc, state);
  for (const ep of tree.entryPoints) {
    if (checkCondition(ep.condition, ctx)) return ep.nodeId;
  }
  return null;
}

export function hasMatchingDialogueEntry(player: Agent, npc: Agent, state: SimulationState): boolean {
  return resolveDialogueEntryNode(player, npc, state) !== null;
}
```

- [ ] **Step 4: Refactor `startDialogue` to use the helper**

In `server/src/dialogue/session-manager.ts`, replace the inline entry-point evaluation block (currently at lines 98-138) with:

```ts
import { resolveDialogueEntryNode } from "../simulation/dialogue-entry-predicate.js";

// ... inside startDialogue, after the tree is fetched:
const entryNodeId = resolveDialogueEntryNode(player, target, state) ?? tree.root;
```

Remove the local `checkCondition` import and `EvalContext` construction — the helper owns them now. Leave the auto-face behaviour untouched (it is not part of entry-point evaluation).

- [ ] **Step 5: Run predicate + session-manager tests; verify green**

```bash
pnpm --filter @town-zero/server test -- "(dialogue-entry-predicate|session-manager)"
```

Expected: all tests pass. If `session-manager.test.ts` covers entry-point behaviour, confirm no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/src/simulation/dialogue-entry-predicate.ts \
        server/test/simulation/dialogue-entry-predicate.test.ts \
        server/src/dialogue/session-manager.ts
git commit -m "refactor(dialogue): extract pure entry-point predicate"
```

---

## Task 3: Tighten existing `attack` handler to facing-only

**Files:**
- Modify: `server/src/simulation/execute-frame.ts` (case `"attack"`, ~line 87-93)
- Modify: `server/test/simulation/execute-frame.test.ts`

This task changes semantics for *any* caller of `{ type: "attack" }`: players, bots, LLM. All must target the facing tile.

- [ ] **Step 1: Write failing tests**

Append to `server/test/simulation/execute-frame.test.ts`:

```ts
describe("attack — facing-only", () => {
  it("damages a target on the agent's facing tile", () => {
    // setup: agent at (1,1) facing east, enemy at (2,1) — facing tile
    // expected: enemy HP reduced by BASE_ATTACK_DAMAGE
  });

  it("does nothing when target is side-adjacent but not on the facing tile", () => {
    // setup: agent at (1,1) facing east, enemy at (1,2) — side-adjacent
    // expected: enemy HP unchanged
  });

  it("rejects LLM-issued attack on a non-facing adjacent tile (bot path)", () => {
    // setup: bot agent at (1,1) facing east, enemy at (1,0) — north-adjacent
    // drive through planBacklog path; expected: enemy HP unchanged
  });
});
```

Fill in each test body using the same harness pattern as existing tests in the file (refer to the current attack test for `Grid` + `Agent` wiring).

- [ ] **Step 2: Run tests; verify red**

```bash
pnpm --filter @town-zero/server test -- execute-frame
```

Expected: the two non-facing cases fail (attack currently succeeds via `grid.isAdjacent`).

- [ ] **Step 3: Change the handler**

In `server/src/simulation/execute-frame.ts`, replace the attack case body:

```ts
case "attack": {
  const target = agents.get(action.targetId);
  if (!target || !target.isAlive()) return;
  if (!isFacingTile(agent, target.position)) return;
  target.takeDamage(BASE_ATTACK_DAMAGE);
  break;
}
```

(`isFacingTile` is already defined in the same file.)

- [ ] **Step 4: Run tests; verify green**

```bash
pnpm --filter @town-zero/server test -- execute-frame
```

Expected: all pass. If any existing tests assumed side-adjacent attacks, update them to reflect the new facing-only rule (the spec's §1.2 intentionally tightens this for all callers).

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/execute-frame.ts server/test/simulation/execute-frame.test.ts
git commit -m "feat(combat): tighten attack to facing-only for all callers"
```

---

## Task 4: Implement `dispatchInteract`

**Files:**
- Create: `server/src/simulation/dispatch-interact.ts`
- Create: `server/test/simulation/dispatch-interact.test.ts`
- Modify: `server/src/simulation/execute-frame.ts` — export sub-handlers (`performAttack`, `performGather`, `performTalk`) for reuse, or expose `executeAction` such that the dispatcher can delegate to it. Recommended: extract the three sub-handlers into named exported helpers inside the file so the dispatcher imports them cleanly without circular dependencies.

- [ ] **Step 1: Extract sub-handler helpers in `execute-frame.ts`**

Refactor the `switch (action.type)` cases for `attack`, `gather`, `talk` into small exported helpers:

```ts
export function performAttackOnFacingTarget(targetId: string, ctx: FrameContext): void { /* existing attack logic */ }
export function performGatherOnFacingTile(resourceTile: Position, ctx: FrameContext): void { /* existing gather logic */ }
export function performTalkOnFacingTarget(targetId: string, ctx: FrameContext): void { /* existing talk logic */ }
```

Then simplify the cases in `executeAction` to call these helpers. Run the full suite to confirm no behaviour changes:

```bash
pnpm --filter @town-zero/server test
```

Commit this as a preparatory refactor:

```bash
git add server/src/simulation/execute-frame.ts
git commit -m "refactor(execute-frame): extract per-verb sub-handlers"
```

- [ ] **Step 2: Write failing dispatcher tests**

```ts
// server/test/simulation/dispatch-interact.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { dispatchInteract } from "../../src/simulation/dispatch-interact.js";
import type { FrameContext } from "../../src/simulation/execute-frame.js";
// plus helpers to build Agents, Grid, SimulationState

describe("dispatchInteract — priority order", () => {
  it("rule 1: merchant on facing tile — returns silently (client opens modal; server noop)", () => { /* ... */ });
  it("rule 2: alive target with matching dialogue entry → talk", () => { /* ... */ });
  it("rule 3: alive target, different faction, no entry → attack", () => { /* ... */ });
  it("rule 4: alive target, same faction, no entry → noop (no HP change, no dialogue)", () => { /* ... */ });
  it("rule 5: resource tile (bush) → gather adds inventory", () => { /* ... */ });
  it("rule 6: empty tile → noop", () => { /* ... */ });
  it("dead agent on facing tile is invisible to dispatcher", () => { /* ... */ });
});
```

Implement each test body with explicit grid and agent setup (see existing `execute-frame.test.ts` for the harness).

- [ ] **Step 3: Run tests; verify red**

```bash
pnpm --filter @town-zero/server test -- dispatch-interact
```

- [ ] **Step 4: Implement `dispatchInteract`**

```ts
// server/src/simulation/dispatch-interact.ts
import { DIRECTION_DELTA } from "@town-zero/shared";
import type { FrameContext } from "./execute-frame.js";
import {
  performAttackOnFacingTarget,
  performGatherOnFacingTile,
  performTalkOnFacingTarget,
} from "./execute-frame.js";
import { hasMatchingDialogueEntry } from "./dialogue-entry-predicate.js";

export function dispatchInteract(ctx: FrameContext): void {
  const { agent, agents, grid, simState } = ctx;
  const delta = DIRECTION_DELTA[agent.facing];
  const target = { x: agent.position.x + delta.dx, y: agent.position.y + delta.dy };
  if (!grid.inBounds(target.x, target.y)) return;

  // Find an alive agent on the facing tile
  let occupant: import("./agent.js").Agent | null = null;
  for (const [, other] of agents) {
    if (!other.isAlive()) continue;
    if (other.position.x === target.x && other.position.y === target.y) {
      occupant = other;
      break;
    }
  }

  if (occupant) {
    // Rule 1 — merchant: server-side noop. Client handles modal locally.
    if (occupant.role === "merchant") return;

    // Rule 2 — dialogue entry match
    if (simState && hasMatchingDialogueEntry(agent, occupant, simState as any)) {
      performTalkOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 3 — hostile
    if (occupant.faction !== agent.faction) {
      performAttackOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 4 — same faction, no entry → noop
    return;
  }

  // Rule 5 — resource tile
  if (grid.getResourceYield(target.x, target.y)) {
    performGatherOnFacingTile(target, ctx);
    return;
  }

  // Rule 6 — empty → noop
}
```

- [ ] **Step 5: Run tests; verify green**

```bash
pnpm --filter @town-zero/server test -- dispatch-interact
```

- [ ] **Step 6: Commit**

```bash
git add server/src/simulation/dispatch-interact.ts \
        server/test/simulation/dispatch-interact.test.ts
git commit -m "feat(combat): implement dispatchInteract with 6-rule priority"
```

---

## Task 5: Wire `interact` case into `executeFrame`

**Files:**
- Modify: `server/src/simulation/execute-frame.ts`
- Modify: `server/test/simulation/execute-frame.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
describe("executeFrame — interact verb", () => {
  it("facing hostile enemy → damage applied", () => {
    // agent at (1,1) facing east; enemy faction=b at (2,1)
    // executeFrame({ seq: 1, action: { type: "interact" } }, ctx)
    // expect: enemy.hp === 100 - BASE_ATTACK_DAMAGE
  });

  it("facing resource bush → inventory increases", () => { /* ... */ });
  it("facing nothing → no state change", () => { /* ... */ });
});
```

- [ ] **Step 2: Run test; verify red**

- [ ] **Step 3: Add `interact` case to `executeAction` switch**

```ts
import { dispatchInteract } from "./dispatch-interact.js";
// ...
case "interact": {
  dispatchInteract(ctx);
  break;
}
```

- [ ] **Step 4: Run test; verify green**

```bash
pnpm --filter @town-zero/server test -- execute-frame
```

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/execute-frame.ts server/test/simulation/execute-frame.test.ts
git commit -m "feat(combat): wire interact action into executeFrame"
```

---

## Task 6: Client — remove KeyQ, send `interact` frame from KeyE

**Files:**
- Modify: `client/src/input.ts` (around lines 23, 27, 48, 270-295, 316-356)

- [ ] **Step 1: Remove KeyQ from `ACTION_CODES` and HUD hint**

In `client/src/input.ts`:

```ts
const ACTION_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyT"] as const;
// Remove KeyQ from the labels record and HUD hint string.
```

The HUD hint changes from `...E:Interact  Q:Attack  T:Deposit` to `...E:Interact  T:Deposit`.

- [ ] **Step 2: Delete the `case "KeyQ"` branch**

Remove lines 271-283 entirely (the current KeyQ attack handler).

- [ ] **Step 3: Simplify `handleInteract` to send `interact`**

The method still short-circuits to open the trade modal client-locally when a merchant is on the facing tile. Otherwise it sends a single `{ type: "interact" }` action frame without any NPC/resource scan.

```ts
private handleInteract(): void {
  if (!this.playerAgent) return;
  const target = this.getServerFacingTile();
  if (!target) return;

  const atFacing = (e: NearbyEntity) => e.x === target.x && e.y === target.y;

  // Merchant short-circuit — open modal client-side, do not send a frame (spec §1.4 Option A)
  const merchant = this.nearbyEntities.find((e) => e.role === "merchant" && atFacing(e));
  if (merchant) {
    this.onModal?.({ type: "trade", merchantId: merchant.id });
    return;
  }

  ++this.inputSeq;
  const frame: InputFrame = { seq: this.inputSeq, action: { type: "interact" } };
  this.onSendInput?.(frame);
  this.pendingInputs.push(frame);
}
```

No per-target selection happens on the client for attack/talk/gather. Server owns dispatch.

- [ ] **Step 4: Build client + manual smoke test**

```bash
pnpm run build
pnpm run dev:server & pnpm run dev:client
```

- Open browser, connect with two tabs (or one + a bot spawn).
- Face an enemy → press E → HP drops.
- Face a same-faction NPC with dialogue entry → press E → dialogue opens.
- Face a bush → press E → food/material increments.
- Face nothing → press E → no change.

Document outcomes; if the client cannot be run in this environment, note so explicitly in the commit body.

- [ ] **Step 5: Commit**

```bash
git add client/src/input.ts
git commit -m "feat(client): unify interact key — remove KeyQ, send interact verb"
```

---

## Task 7: Agent bubble fields + `setBubble` API

**Files:**
- Modify: `server/src/simulation/agent.ts`
- Create: `server/test/simulation/bubble.test.ts`

- [ ] **Step 1: Write failing tests for `setBubble` + expiry**

```ts
// server/test/simulation/bubble.test.ts
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";

describe("Agent.setBubble", () => {
  it("sets bubbleText and computes bubbleExpiresAt from current tick", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("早安", 80, /*currentTick*/ 100);
    expect(a.bubbleText).toBe("早安");
    expect(a.bubbleExpiresAt).toBe(180);
  });

  it("clears immediately when text is empty or duration is zero", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("hi", 10, 0);
    a.setBubble("", 0, 5);
    expect(a.bubbleText).toBeNull();
    expect(a.bubbleExpiresAt).toBe(0);
  });

  it("truncates overlong text to the schema cap", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const long = "x".repeat(200);
    a.setBubble(long, 10, 0);
    expect(a.bubbleText!.length).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 2: Run test; verify red**

```bash
pnpm --filter @town-zero/server test -- bubble
```

- [ ] **Step 3: Add fields and API to Agent**

In `server/src/simulation/agent.ts`:

```ts
// In class fields:
bubbleText: string | null = null;
bubbleExpiresAt: number = 0;

// New method:
setBubble(text: string, durationTicks: number, currentTick: number): void {
  const BUBBLE_MAX_LEN = 64;
  if (!text || durationTicks <= 0) {
    this.bubbleText = null;
    this.bubbleExpiresAt = 0;
    return;
  }
  this.bubbleText = text.length > BUBBLE_MAX_LEN ? text.slice(0, BUBBLE_MAX_LEN) : text;
  this.bubbleExpiresAt = currentTick + durationTicks;
}
```

- [ ] **Step 4: Run tests; verify green**

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/bubble.test.ts
git commit -m "feat(agent): bubbleText/expiresAt fields + setBubble API"
```

---

## Task 8: Proximity-bubble config + per-(npc, player) ledger + cleanup helpers

**Files:**
- Modify: `server/src/simulation/agent.ts`
- Modify: `server/test/simulation/bubble.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("Agent.proximityBubble", () => {
  it("exposes a typed proximityBubble config field (optional)", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    expect(a.proximityBubble).toBeUndefined();
  });

  it("tracks last trigger tick per player in the proximity ledger", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    expect(a.getLastProximityTrigger("p1")).toBe(100);
    expect(a.getLastProximityTrigger("p2")).toBeUndefined();
  });

  it("removes a player from the ledger on disconnect-cleanup", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    a.forgetPlayerProximity("p1");
    expect(a.getLastProximityTrigger("p1")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run; verify red**

- [ ] **Step 3: Add fields and methods**

```ts
export interface ProximityBubbleConfig {
  text: string;
  durationTicks: number;
  cooldownTicks: number;
}

// In AgentInit add:
proximityBubble?: ProximityBubbleConfig;

// In class:
proximityBubble?: ProximityBubbleConfig;
private proximityLedger: Map<string, number> = new Map();

recordProximityTrigger(playerId: string, tick: number): void {
  this.proximityLedger.set(playerId, tick);
}
getLastProximityTrigger(playerId: string): number | undefined {
  return this.proximityLedger.get(playerId);
}
forgetPlayerProximity(playerId: string): void {
  this.proximityLedger.delete(playerId);
}
```

In the constructor, assign `this.proximityBubble = init.proximityBubble;`.

- [ ] **Step 4: Run; verify green**

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/bubble.test.ts
git commit -m "feat(agent): proximityBubble config + per-player ledger"
```

---

## Task 9: Tick loop — bubble expiry + proximity trigger pass

**Files:**
- Modify: `server/src/simulation/tick.ts`
- Modify: `server/test/simulation/bubble.test.ts` (or add integration test)

The new work slots *between* Phase 6 (vision) and Phase 7 (memory merge), since proximity uses the per-agent `mapMemory` only for fog display (not for the trigger logic — the trigger uses real positions). Add it as **Phase 6b: bubble upkeep**.

- [ ] **Step 1: Write failing integration test**

```ts
describe("processTick — bubble upkeep", () => {
  it("clears bubble when bubbleExpiresAt is reached", () => {
    // NPC with setBubble("hi", 2, 0); processTick twice → cleared on the tick after expiry
  });

  it("fires proximityBubble when a player enters the NPC's vision radius", () => {
    // NPC with proximityBubble={text,duration,cooldown}; player spawned in range → after processTick, NPC.bubbleText === text
  });

  it("does not re-fire within cooldownTicks", () => {
    // fire once; advance fewer ticks than cooldown; player still in vision → bubble stays cleared after expiry, no re-fire
  });

  it("re-fires after cooldown once player returns to vision", () => { /* ... */ });
});
```

- [ ] **Step 2: Run; verify red**

- [ ] **Step 3: Implement Phase 6b**

In `processTick` after `updateVision`:

```ts
// Phase 6b: Bubble upkeep (expiry + proximity triggers)
for (const [, agent] of agents) {
  // Expiry
  if (agent.bubbleText !== null && tick >= agent.bubbleExpiresAt) {
    agent.setBubble("", 0, tick);
  }

  // Proximity trigger
  if (!agent.proximityBubble) continue;
  const cfg = agent.proximityBubble;
  for (const [, other] of agents) {
    if (other.controller !== "player") continue;
    if (!other.isAlive()) continue;
    // In vision iff the NPC sees the player this tick (use Manhattan radius)
    const dx = Math.abs(other.position.x - agent.position.x);
    const dy = Math.abs(other.position.y - agent.position.y);
    if (dx + dy > (agent.role === "scout" ? 8 : 5)) continue;

    const last = agent.getLastProximityTrigger(other.id);
    if (last !== undefined && tick - last < cfg.cooldownTicks) continue;

    agent.setBubble(cfg.text, cfg.durationTicks, tick);
    agent.recordProximityTrigger(other.id, tick);
    break; // One fire per tick; others arriving within duration share the same text.
  }
}
```

Reuse `tilesInManhattanRadius` or the numeric constants from `@town-zero/shared` if they exist; otherwise keep the inline Manhattan distance. Do *not* duplicate the full `getTilesInRadius` iteration — we only need a "within radius?" check.

- [ ] **Step 4: Run tests; verify green**

```bash
pnpm --filter @town-zero/server test -- bubble
```

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/tick.ts server/test/simulation/bubble.test.ts
git commit -m "feat(tick): bubble expiry + proximity-trigger phase"
```

---

## Task 10: Sync `bubbleText` over Colyseus schema

**Files:**
- Modify: `server/src/rooms/schemas/AgentSchema.ts`
- Modify: `server/src/rooms/sync.ts`

- [ ] **Step 1: Add field to `AgentSchema`**

```ts
export const AgentSchema = schema({
  id: "string",
  faction: "string",
  role: "string",
  x: "number",
  y: "number",
  hp: "number",
  maxHp: "number",
  state: "string",
  controller: "string",
  facing: "string",
  lastProcessedInput: "number",
  inventory: { map: "number" },
  bubbleText: "string",    // new
}, "AgentSchema");
```

- [ ] **Step 2: Write the sync line**

In `syncAgent` (`server/src/rooms/sync.ts`):

```ts
agentSchema.bubbleText = agent.bubbleText ?? "";
```

(Empty string denotes "no bubble" on the wire; rendering treats `""` as absent.)

- [ ] **Step 3: Rebuild + run existing sync tests**

```bash
pnpm run build
pnpm --filter @town-zero/server test -- sync
```

(If no sync-specific test file exists, integration tests through `processTick` already cover this.)

- [ ] **Step 4: Commit**

```bash
git add server/src/rooms/schemas/AgentSchema.ts server/src/rooms/sync.ts
git commit -m "feat(schema): sync Agent.bubbleText to clients"
```

---

## Task 11: Dialogue-start clears bubble

**Files:**
- Modify: `server/src/dialogue/session-manager.ts`
- Modify: `server/test/dialogue/session-manager.test.ts` (extend)

- [ ] **Step 1: Write failing test**

```ts
it("startDialogue clears the target NPC's active bubble", () => {
  // NPC with bubbleText="早安", setBubble at tick 0, duration 80
  // call startDialogue; expect npc.bubbleText === null
});
```

- [ ] **Step 2: Run; verify red**

- [ ] **Step 3: Add the clear on success path**

Just before the final `return { ok: true, ... }` in `startDialogue`, after `state.activeSessions.set(targetId, session)`:

```ts
target.setBubble("", 0, state.tick);
```

Place it inside the try block, after session creation, so an early-error path does not leave the bubble cleared unintentionally. (Review: if `buildPayload` throws and we `endDialogue`, the bubble stays cleared — that is acceptable, since the NPC was about to speak anyway.)

- [ ] **Step 4: Run; verify green**

- [ ] **Step 5: Commit**

```bash
git add server/src/dialogue/session-manager.ts server/test/dialogue/session-manager.test.ts
git commit -m "feat(dialogue): clear NPC bubble on session start"
```

---

## Task 12: GameRoom disconnect — purge proximity ledger entries

**Files:**
- Modify: `server/src/rooms/GameRoom.ts` (`onLeave`, ~line 146)
- Modify: `server/test/` (pick a suitable integration test file or create one)

- [ ] **Step 1: Write failing test**

```ts
it("onLeave removes the player from every NPC's proximity ledger", () => {
  // spawn two NPCs with proximityBubble, trigger them for player p1,
  // then call room.onLeave(p1.client); expect each NPC to not have p1 in its ledger
});
```

- [ ] **Step 2: Run; verify red**

- [ ] **Step 3: Add the cleanup**

In `onLeave`, after the existing bot-takeover / removal logic, iterate `this.simState.agents` and call `agent.forgetPlayerProximity(playerId)` on each. Keep this cheap — a single pass over agents.

- [ ] **Step 4: Run; verify green**

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/test/...
git commit -m "feat(room): purge proximity ledger entries on player disconnect"
```

---

## Task 13: Client rendering — floating bubble text

**Files:**
- Modify: `client/src/renderer.ts`
- Modify: `client/src/types.ts` (if a local agent snapshot type exists)

- [ ] **Step 1: Thread `bubbleText` through whatever snapshot the renderer uses**

Confirm where the renderer reads agent data (likely the Colyseus state proxy or a derived snapshot). Add `bubbleText?: string` to the snapshot shape if one exists.

- [ ] **Step 2: Render the bubble**

For each agent currently being drawn:
- If `bubbleText` is non-empty *and* the tile the agent stands on is visible through fog → draw a short text tag above the sprite.
- No client-side expiry math — the empty string is the clear signal.

Suggested visual: Canvas 2D `fillText` with background rectangle, positioned `y - spriteHeight - 16px` from the agent's render position. Use `textContent`-equivalent safe rendering (Canvas 2D has no XSS surface).

- [ ] **Step 3: Manual smoke test**

Run both dev servers, spawn an NPC with a `proximityBubble` config in a test scenario, approach it, confirm the bubble text appears and disappears.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer.ts client/src/types.ts
git commit -m "feat(client): render NPC dialog bubbles above sprites"
```

---

## Task 14: Documentation updates — CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove the facing-only-attack debt line**

Delete the TODO entry about KeyQ becoming facing-only (it is now done).

- [ ] **Step 2: Rewrite the "Facing-based interaction" paragraph**

Replace:

> "Facing-based interaction: interact (KeyE) checks the facing tile for merchants (trade modal), same-faction NPCs (talk), or resource tiles (gather). Attack (KeyQ) currently checks any adjacent enemy but should be changed to facing-only in the future"

with:

> "Facing-based interaction: KeyE sends a single `{ type: "interact" }` frame. Server-side `dispatchInteract` resolves the agent's facing tile against a 6-rule priority (merchant modal client-side; dialogue-entry-matching agent → talk; hostile agent → attack; same-faction no-entry → noop; resource tile → gather; else noop). Attack is facing-only for all callers including LLM plans. KeyQ is not bound."

- [ ] **Step 3: Add a bubble-channel note**

In the "Dialogue" area, append:

> "NPCs expose a one-way bubble channel via `Agent.setBubble(text, durationTicks, currentTick)` and a synced `bubbleText` field on `AgentSchema`. In v1 the only wired source is `proximityBubble` (per-NPC config with duration + cooldown and a per-player ledger); dialogue start clears the bubble. Rendering is client-side and skips fog-hidden NPCs."

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for interact verb + bubble channel"
```

---

## Task 15: Full-suite sanity run + open PR

- [ ] **Step 1: Run the full server suite**

```bash
pnpm run test
```

Fix anything red before proceeding. Do not leave skipped tests.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/combat-as-interaction
gh pr create --title "feat: combat as interaction + NPC dialog bubble" \
  --body "$(cat <<'EOF'
## Summary
- Unify `attack` into the `interact` verb dispatched server-side from the agent's facing tile
- Tighten attack to facing-only for all callers (players, bots, LLM)
- Remove client-side KeyQ; KeyE sends `{ type: "interact" }`
- Decoupled NPC bubble channel (`bubbleText` synced; `setBubble` API; proximity-trigger source; dialogue-start clear; disconnect-safe ledger)

## Spec / Plan
- Spec: `docs/superpowers/specs/001-combat-as-interaction-design.md`
- Plan: `docs/superpowers/plans/001-combat-as-interaction.md`

## Test plan
- [ ] Unit: `dispatchInteract` priority rules + attack facing-only
- [ ] Unit: bubble expiry, proximity-trigger (fire/cooldown/re-fire)
- [ ] Unit: disconnect purges proximity ledger
- [ ] Integration: belief-flip flips dispatcher outcome talk↔attack
- [ ] Manual: KeyE attacks facing enemy, talks to NPC with entry, gathers bush; bubble appears on approach and clears on dialogue start

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Summary of commits (expected sequence)

1. `feat(shared): add interact FrameAction variant + validation`
2. `refactor(dialogue): extract pure entry-point predicate`
3. `feat(combat): tighten attack to facing-only for all callers`
4. `refactor(execute-frame): extract per-verb sub-handlers`
5. `feat(combat): implement dispatchInteract with 6-rule priority`
6. `feat(combat): wire interact action into executeFrame`
7. `feat(client): unify interact key — remove KeyQ, send interact verb`
8. `feat(agent): bubbleText/expiresAt fields + setBubble API`
9. `feat(agent): proximityBubble config + per-player ledger`
10. `feat(tick): bubble expiry + proximity-trigger phase`
11. `feat(schema): sync Agent.bubbleText to clients`
12. `feat(dialogue): clear NPC bubble on session start`
13. `feat(room): purge proximity ledger entries on player disconnect`
14. `feat(client): render NPC dialog bubbles above sprites`
15. `docs: update CLAUDE.md for interact verb + bubble channel`

Small, focused, easy to bisect. Each ships working, testable software on its own; none leaves the codebase in a red state.
