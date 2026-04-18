# 001 — Combat as Interaction (unified verb) + NPC Dialog Bubble

Status: Draft
Date: 2026-04-18
Depends on: `2026-04-05-unified-input-frame-design.md`, `2026-04-04-facing-npc-dialogue-design.md`

## Summary

Fold attack into the existing facing-tile interaction pipeline. A single `interact` verb replaces the specialised client-side KeyQ attack path. The server owns dispatch: given the player's facing tile and its contents, it resolves to `attack`, `talk`, `gather`, or `trade` via existing sub-handlers. Attack becomes facing-only, eliminating the known debt that KeyQ operates on any adjacent enemy.

A companion (but fully decoupled) feature adds an NPC-driven "dialog bubble" channel: NPCs can emit short floating text (e.g. "早安") at configured triggers, visible to players who can see the NPC through fog of war. Bubbles have no causal relationship to the interact dispatcher — they are pure outward-facing signal.

## Motivation

### Combat unification

Current state:
- Client `handleInteract()` (KeyE): facing-tile dispatch across merchant → same-faction NPC → resource gather.
- Client KeyQ attack: scans `nearbyEntities` for any adjacent enemy, ignores facing.
- Server `executeAction` for `attack`: `grid.isAdjacent(agent.position, target.position)` — not facing-constrained.
- Facing-only attack is listed as known debt in `CLAUDE.md`.

Problems:
1. Combat mechanics bypass the facing-tile model that every other player verb obeys. Players must internalise two distinct targeting models.
2. Client-side target selection for attack means the server cannot become the sole authority on "what did the player mean to do". If client and server disagree (fog lag, recent movement), attack semantics diverge from interact semantics.
3. Adding new facing-tile verbs (chop, open, etc.) requires touching client dispatch logic every time.

### Dialog bubble

Players currently have no way to tell an NPC's expressive state at a glance. "NPC has something to say" only manifests when the player presses E — so the player must speculatively interact to find out. This breaks immersion and wastes time.

A bubble channel lets NPCs surface their state outwardly ("早安", "歡迎來到村子") as a first-class signal, aligned with the project's C4ISR emphasis on observable cues over omniscient state reads.

## Non-goals

- No new combat mechanics (weapons, cooldowns, damage types, armour, ranged attacks).
- No surrender / parley state machine. These can later be expressed via beliefs + dialogue entryPoints without further engine work.
- No LLM-generated bubble text. Bubbles in v1 are scripted strings.
- No trigger-rule-driven bubble emission. That is a future hook; the trigger-rule execution layer has its own debt (see `CLAUDE.md`).
- No migration of existing date-prefixed spec files to 3-digit prefixes. This spec starts the new numbering; existing specs stay as-is until a dedicated rename pass.

## Design

### Part 1 — Interact as a unified verb

#### 1.1 FrameAction extension

Add one variant to `FrameAction` in `shared/src/types.ts`:

```ts
export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "talk"; targetId: string }
  | { type: "interact" }          // NEW
  | { type: "idle" };
```

No existing variants are removed or modified. LLM planners continue to emit specific-type actions because they know exactly which agent or tile they target. Human players emit `interact` and let the server resolve.

#### 1.2 Server-side dispatcher

Introduce a new server helper:

```ts
function dispatchInteract(ctx: FrameContext): void
```

It computes `facingTile(agent)`, inspects the tile, and calls into the existing `executeAction` sub-handlers. The priority order on the facing tile `T`:

1. **Merchant agent** present → emit a `trade_available` signal to the client; the client opens the trade modal. (See §1.4 for rationale.)
2. **Alive agent with a matching dialogue entryPoint** (evaluated against the target's beliefs via the existing `startDialogue` precheck) → dispatch `talk`.
3. **Alive agent, different faction** (no matching dialogue entry) → dispatch `attack`.
4. **Alive agent, same faction, no matching dialogue entry** → noop.
5. **Resource tile** (bush / yields `getResourceYield`) → dispatch `gather`.
6. **Otherwise** → noop.

Dead agents on the tile are invisible to the dispatcher (no action).

Dispatch is a pure tick-time operation: rule 2's dialogue-entry check runs at dispatch time, so any belief change committed before this tick is reflected. Since dialogue is data-driven, no combat-side surrender logic is needed — authors simply add a dialogue tree entry whose condition is a belief flag, and dispatcher rule 2 picks it up automatically.

**Implementation note — pure predicate:** rule 2's check must be a side-effect-free predicate `hasMatchingDialogueEntry(target, player, state)` that reuses the existing `EvalContext` plumbing used by `startDialogue`. The dispatcher must not speculatively invoke `startDialogue` itself (which locks agents and mutates facing). Only after rule 2 commits does the server then call `startDialogue`.

**Entry-less dialogue trees:** if a dialogue tree has a plain `root` node and no `entryPoints` array, rule 2 does not match. Cross-faction targets with such trees therefore fall through to rule 3 (attack). This is intentional — entry-less trees represent "talk only when explicitly addressed by a same-faction ally" (rule 4 noop for same faction). Authors who want a cross-faction ambient-talkable NPC must define at least one `entryPoints` entry.

Existing `executeAction` case `"attack"` is changed:
- `grid.isAdjacent(agent.position, target.position)` → `isFacingTile(agent, target.position)`.
- Behaviour for LLM-issued `attack` actions also tightens to facing-only, consistent with all other facing-verbs.

Existing `executeAction` case `"talk"` keeps its current check (`isFacingTile`). No change.

The new `case "interact"` inside `executeAction` simply calls `dispatchInteract(ctx)`.

#### 1.3 Client changes

In `client/src/input.ts`:
- Remove the `KeyQ` branch entirely (along with its entry in `ACTION_CODES` and the HUD hint string).
- Change `handleInteract` to unconditionally build `{ seq, action: { type: "interact" } }` and send it. No per-target selection happens on the client.
- `nearbyEntities` state is retained — it remains useful for HUD hints (e.g. "E: Attack" vs "E: Talk" previewed when the player is facing a known entity), but it is not consulted to build the frame.

HUD hint text is advisory only; ground truth is the server-side dispatcher. If the client's preview disagrees with the server's outcome (stale fog, belief changed mid-flight), the outcome is whatever the server chose.

**HUD hint logic is not an acceptance-criterion of this spec.** The HUD may retain its current static legend (e.g. "E: Interact") without context-sensitive previewing. Context-aware previews ("E: Attack" vs "E: Talk") are a future enhancement and should not expand the scope of the implementation plan derived from this spec.

No client-side prediction of interact effects is performed. This is consistent with the existing behaviour of `gather`, `talk`, and `trade` (all instant effects, no client prediction).

#### 1.4 Trade modal special case

The trade modal is a client-only UI element. Option A (recommended): the client detects a merchant on its facing tile and opens the modal locally without sending a frame. This avoids a frame round-trip for a pure UI transition. The server still authoritatively validates any trade action the modal subsequently issues.

Option B (considered, rejected): the client always sends `interact`; the server replies with `trade_available(merchantId)`; the client opens the modal. Cleaner protocol shape but adds latency for no behavioural gain. Rejected for v1.

Under Option A, dispatcher priority rule 1 on the server remains defined so that LLM/bot agents (if they ever face merchants and issue `interact`) get a consistent resolution — though LLMs will normally emit the specific `trade` action directly.

**Merchants do not get bubbles in v1.** Merchant NPC configs must not carry a `proximityBubble`. This sidesteps the edge case of a client opening a trade modal without firing `startDialogue` (and therefore without clearing any bubble) for an entity that happens to be both merchant and bubble-source.

#### 1.5 Sequence / reconciliation

`interact` frames use the existing `seq`-bearing `InputFrame` path, counted into `lastProcessedInput` exactly like any other player action frame. They are action-only frames (no `direction`), so client-side replay during reconciliation skips them — consistent with `display.ts`' current behaviour of replaying direction-only frames.

### Part 2 — NPC dialog bubble (decoupled channel)

#### 2.1 Schema

`Agent` gains:

```ts
// Synced (Colyseus schema, subject to per-client vision filter):
bubbleText: string | null      // current bubble content, null when none

// Server-only (not in schema):
bubbleExpiresAt: number        // tick at which the server clears bubbleText
```

Only `bubbleText` is synced. `bubbleExpiresAt` is a server-side implementation detail — the client trusts the server to clear the text and performs no expiry math locally. Keeping `bubbleExpiresAt` out of the schema avoids unnecessary schema-diff bandwidth for a value the client does not use.

Fog of war already filters which agents are visible to each player; `bubbleText` inherits that filter automatically.

#### 2.2 API

Agent gains one method:

```ts
agent.setBubble(text: string, durationTicks: number): void
```

Implementation:
- Sets `bubbleText = text`, `bubbleExpiresAt = currentTick + durationTicks`.
- Calling `setBubble` with an empty string or zero duration clears immediately.

The tick loop adds a tiny pass:
- For each agent with `bubbleText !== null && currentTick >= bubbleExpiresAt` → clear both fields.

This is the only bubble-lifetime mechanism in v1. All sources below funnel through `setBubble`.

#### 2.3 v1 bubble sources

Exactly two wired sources in v1:

##### 2.3.1 Proximity trigger

NPC-spawn config may include:

```ts
proximityBubble?: {
  text: string;
  durationTicks: number;    // how long the bubble shows per trigger
  cooldownTicks: number;    // minimum ticks before the same NPC can re-trigger for the same player
}
```

Each tick, for every NPC with a `proximityBubble`:
- For every player whose vision currently contains this NPC:
  - If this NPC has not triggered for this player within `cooldownTicks` → call `setBubble(text, durationTicks)` and record the trigger tick for `(npcId, playerId)`.

The per-(npc, player) trigger ledger lives on the NPC (small `Map<playerId, tick>`). When a player leaves vision and re-enters after the cooldown window, the bubble fires again.

**Ledger cleanup:** remove the player's entry when (a) the player disconnects (`onLeave`), or (b) the NPC dies (`state === "dead"`; the ledger Map itself is released along with the agent). This avoids retaining stale `playerId` keys after their owners are gone.

Because there is a single shared `bubbleText` per NPC (not per-viewer), concurrent eligibility from multiple players collapses naturally: the first player to enter vision triggers the bubble; other players arriving within `durationTicks` simply see the same bubble. This is acceptable for a "greeting" UX and keeps schema per-NPC rather than per-(NPC, player).

##### 2.3.2 Dialogue-start clear

On dialogue session start (`startDialogue` succeeds):
- Call `npc.setBubble("", 0)` to clear immediately.

This enforces the user-specified rule: **when talking begins, the bubble disappears**. The in-dialogue NPC speaks through the dialogue UI, not through the bubble.

On dialogue end, no automatic re-trigger; proximity logic will re-fire on the next eligible tick if the player leaves and returns after cooldown.

#### 2.4 Future sources (explicitly out of scope)

- Trigger-rule `emit_bubble(text, durationTicks)` effect. Blocked by the open debt in `CLAUDE.md` around trigger-rule execution. Once that layer is finished, adding a new effect type that calls `setBubble` is trivial.
- LLM-authored ambient chatter.
- Scenario script bubble calls (could be added by directly invoking `setBubble` from a scenario hook; not wired in v1).

#### 2.5 Rendering (client)

In `client/src/renderer.ts`:
- When drawing an agent, if `bubbleText` is non-empty and `currentTick < bubbleExpiresAt`, render a short text block above the agent sprite. Tick comparison uses server-provided tick (already synced) or a simple "has text → show" check that relies on server clearing (safer, avoids client/server tick drift).

Recommendation: simple "has text → show" — trust server to clear. No client-side expiry math. Schema diff will drop the text when server clears it.

Bubble text is short (enforce server-side cap, e.g. 64 characters).

## Security / input validation

- `interact` frames have no payload beyond `seq` + `type`. `isValidInputFrame` needs a small extension to accept the new variant.
- Dispatcher on the server uses the agent's own facing and position — not anything from the client — so clients cannot target arbitrary tiles. This is a strict security improvement over the previous KeyQ attack path, which trusted a client-supplied `targetId`.
- Existing dialogue-lock (`talkingToNpcId` / `currentTalkingTo`) already gates all input in `executeFrame`; `interact` inherits this without change.
- `setBubble` is called from server-side code only. Clients cannot set bubbles directly.
- Bubble text length cap prevents pathological payloads in schema diffs.

## Compatibility

- LLM plans, bots, and existing tests are unaffected. They use specific action types.
- Colyseus schema gains two nullable-or-numeric fields on `Agent` — additive, non-breaking for protocol parsers.
- Client's existing `KeyQ` handling is removed. Players must be informed (HUD legend updates automatically since it is derived from `ACTION_CODES`).
- No migration for persisted state — the project is in-memory only.

## Testing strategy

### Unit tests

Server:
- `dispatchInteract`: one test per priority rule (merchant, talkable NPC, hostile NPC, same-faction silent NPC, resource tile, empty tile).
- Facing-only `attack` (player-issued): target on side-adjacent (non-facing) tile → attack rejected as noop.
- Facing-only `attack` (LLM-issued specific action): non-facing `attack` frame from a bot/LLM → rejected as noop, covering the "LLM `attack` also tightens to facing-only" rule in §1.2.
- `attack` via `interact`: facing hostile enemy → damage applied via existing `takeDamage`.
- Talkable-enemy flow: different-faction NPC with a dialogue entryPoint whose condition is true → dispatcher picks `talk`; entry condition false → dispatcher picks `attack`.
- `setBubble`: sets fields, expiry arithmetic correct; tick-loop clears at expiry.
- Dialogue-start clears bubble: start dialogue while bubble active → bubble immediately clears.

Client:
- `KeyE` handler emits a frame with `{ action: { type: "interact" } }` and no target fields.
- `KeyQ` is not bound (regression guard).
- Merchant-in-front short-circuit still opens the modal client-side without sending an `interact` frame.

### Integration tests

- Full tick loop: player faces hostile NPC, issues `interact` → NPC HP drops by `BASE_ATTACK_DAMAGE`.
- Proximity bubble: NPC with `proximityBubble` fires when a player enters vision; does not re-fire within cooldown; re-fires after cooldown once player has left and returned.
- Belief-flip talkable enemy: simulate belief change that activates a dialogue entryPoint; next player `interact` opens dialogue instead of attacking.
- Reconciliation: `interact` frames counted in `lastProcessedInput`; client replay skips them (action-only frames).

## Migration notes

- Rename KeyQ references in `client/src/input.ts` HUD hint string.
- Update `CLAUDE.md`:
  - Remove the facing-only-attack TODO from the "Known Debt" / "TODO" lists.
  - Rewrite the "Facing-based interaction" paragraph so the sentence "Attack (KeyQ) currently checks any adjacent enemy but should be changed to facing-only in the future" is replaced by a description of the new unified `interact` verb and its dispatcher.
  - Add a short note describing the NPC bubble channel (schema field, setBubble API, proximity source).
- No database migrations (state is in-memory).

## Open questions (resolved during brainstorming)

- Dispatch location: client vs server → **server** (authoritative, thin client).
- Dual-key vs single-key → **single-key** (state-driven E, KeyQ removed).
- Surrender / parley mechanics → **out of scope**; expressible via beliefs + dialogue entries alone.
- Bubble coupling to dispatcher → **fully decoupled** per user direction.
- Bubble drivers in v1 → **proximity + dialogue-start-clear only**; other sources are future work.
- Spec numbering → **3-digit prefix (001)** per user's global CLAUDE.md override of the superpowers default; existing date-prefixed specs stay unchanged.

## References

- `docs/superpowers/specs/2026-04-04-facing-npc-dialogue-design.md` — facing + dialogue entryPoint model.
- `docs/superpowers/specs/2026-04-05-unified-input-frame-design.md` — InputFrame and reconciliation.
- `CLAUDE.md` — known debt on facing-only attack and trigger-rule execution.
- `docs/security-review.md` — §10 `input:stop` seq handling (unchanged by this spec; interact frames use standard seq path).
