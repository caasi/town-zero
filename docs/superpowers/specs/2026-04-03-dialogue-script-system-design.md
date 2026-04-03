# Dialogue Script System with Beliefs and Triggers

## Problem

The current dialogue system (`DialogueEngine`) traverses static JSON trees with five node types (`text`, `choice`, `request`, `action`, `end`). The types define `condition` and `effect` string fields, but neither is evaluated. Text content is static strings with no variable interpolation. There is no mechanism for dialogue scripts to read or write game state, no cross-dialogue communication, and no way for NPCs to propagate narrative information through the same information-flow model that `MapMemory` already provides for spatial knowledge.

This means:
- NPC dialogue cannot reference dynamic world state ("the bridge is destroyed")
- Dialogue choices cannot be conditionally shown based on game state
- Dialogue cannot produce side effects (give items, create quests)
- NPCs have omniscient or zero knowledge of narrative events, with no middle ground
- NPC definitions are hardcoded in simulation setup, not data-driven

## Goals

- Text interpolation: dialogue text references dynamic values (beliefs, inventory, etc.)
- Conditional branching: choices and paths depend on evaluated expressions
- Side effects: dialogue actions can modify game state through a white-listed set of operations
- Belief propagation: narrative facts spread between agents using the same adjacency-based merge as `MapMemory`
- Dynamic facts: scripts create new facts at runtime without predefined registries
- Trigger rules: scripts register deferred when-then rules targeting specific agents
- Scenario scripts: NPC definitions, dialogue trees, and triggers co-located in typed eDSL files
- i18n from day one: keyless approach where default-locale text is the translation key
- Serialization guarantee: all data structures round-trip through `JSON.stringify`/`JSON.parse`
- LLM integration: agent beliefs included in LLM prompt context

## Non-Goals

- Save/load system implementation (only serialization round-trip tests)
- Client-side dialogue UI (separate spec)
- LLM-generated dialogue scripts (the eDSL supports it, but tooling is out of scope)
- Anti-cheat for belief state (MVP trusts clients, same as fog of war)
- Expression language beyond arithmetic, comparison, logic, and white-listed function calls

## Design

### 1. Fact and Belief System

A **Fact** is a key-value pair with metadata:

```typescript
interface Fact {
  key: string;
  value: boolean | number | string;
  tick: number;        // when this fact was created or last updated
  source: string;      // agent ID who originated this fact
}
```

Each agent has a **BeliefStore** alongside its existing `MapMemory`:

```typescript
// On Agent class — runtime uses Map, serialized form is Record
beliefs: Map<string, Fact>
// Serializes as: Record<string, Fact>
```

Facts are created dynamically by dialogue effects or game events. There is no predefined registry of fact keys. Any script can create any fact key at runtime.

#### Belief Propagation

Beliefs propagate through the same mechanism as `MapMemory` merge: when two same-faction agents are adjacent, their beliefs merge. The merge rule is: for the same key, the fact with the higher `tick` wins.

```typescript
function mergeBeliefs(target: Map<string, Fact>, source: Map<string, Fact>): void {
  for (const [key, fact] of source) {
    const existing = target.get(key);
    if (!existing || fact.tick > existing.tick) {
      target.set(key, { ...fact });
    }
  }
}
```

This runs at the same point in the tick loop as `MapMemory` merge (step 8), extended to include beliefs.

#### Dialogue Progress (Per-NPC, Non-Propagating)

Separate from beliefs, each agent tracks its own dialogue state:

```typescript
// On Agent class — runtime uses Map, serialized form is Record
dialogueProgress: Map<string, DialogueProgressEntry>

// All fields use JSON-safe types (arrays and records, not Set/Map)
interface DialogueProgressEntry {
  visitedNodes: string[];
  selectedOptions: Record<string, string>;  // nodeId -> optionId
  locals: Record<string, boolean | number | string>;
}
```

This tracks which dialogue branches have been explored with each NPC and persists across conversations. It does not propagate to other agents. The runtime `Map` wrapper around `DialogueProgressEntry` is converted to/from `Record` for serialization.

### 2. Expression AST

All conditions, effects, and text interpolation compile to AST nodes. The runtime engine walks these nodes; no JavaScript is evaluated.

#### Expression Nodes

```typescript
type Value = boolean | number | string;

type Expr =
  | { type: "literal"; value: Value }
  | { type: "fact_ref"; key: string }
  | { type: "local_ref"; key: string }
  | { type: "prop_ref"; target: "player" | "npc" | "settlement"; prop: string }
  | { type: "compare"; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte"; left: Expr; right: Expr }
  | { type: "logic"; op: "and" | "or" | "not"; args: Expr[] }
  | { type: "call"; fn: string; args: Expr[] }
  | { type: "arithmetic"; op: "add" | "sub" | "mul" | "div"; left: Expr; right: Expr };
```

#### Effect Nodes

```typescript
type AgentRef = string;  // agent ID or "$player", "$faction:xxx"

type Effect =
  | { type: "set_fact"; target: AgentRef; key: string; value: Expr }
  | { type: "set_local"; key: string; value: Expr }
  | { type: "give_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "take_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "damage"; target: AgentRef; amount: Expr }
  | { type: "register_trigger"; trigger: TriggerRule };
// item uses ResourceType ("food" | "material" | "currency") from shared/src/types.ts
```

#### Text Template

```typescript
type TextTemplate = Array<string | Expr>;
```

A template like `"你有 {player.food} 個食物"` compiles to:

```json
["你有 ", { "type": "prop_ref", "target": "player", "prop": "food" }, " 個食物"]
```

#### Agent References in Expressions

`AgentRef` strings (`"$player"`, `"$npc"`, `"elder_chen"`, `"$faction:village_a"`) appear in `Effect` nodes as plain strings. When used as arguments to white-listed functions within `Expr`, they are encoded as `{ type: "literal"; value: "$player" }`. The evaluator resolves these magic-prefix strings to actual agent lookups through `EvalContext`.

**Scope rules for special references:**
- `"$npc"` — valid only inside dialogue-scoped effects and triggers. In scenario-level triggers, use concrete agent IDs instead.
- `"$player"` — valid only inside dialogue-scoped effects and triggers, where it is captured as a concrete agent ID at registration time. Scenario-level triggers must not use `"$player"` (no player context exists at load time).
- `"$faction:xxx"` — valid anywhere. Resolved at fire time to all living agents in that faction.

#### Belief Context for `fact_ref`

`fact_ref` reads from `ctx.beliefs`, which is the **NPC's** `BeliefStore`. During dialogue evaluation, the NPC is the "point of view" agent. This means conditions like `fact("bridge_destroyed").eq(true)` check whether *the NPC believes* the bridge is destroyed, not whether it objectively is. The player's beliefs are not consulted during NPC dialogue evaluation.

#### White-Listed Functions

The `call` expression node can invoke these functions:

- `has_item(target, item, amount)` returns boolean — checks if agent has at least `amount` of `item`
- `count_item(target, item)` returns number
- `distance(a, b)` returns number
- `faction_of(agent)` returns string

Arguments with `$`-prefixed strings are resolved as agent references. New functions are added by extending the function registry, not the evaluator.

#### Expression Builder Chain API

The eDSL functions `fact()`, `local()`, and `player.prop()` return an `ExprBuilder` proxy — a thin wrapper around an `Expr` node that exposes chainable methods. Each method returns a new `ExprBuilder` wrapping the resulting AST node.

```typescript
interface ExprBuilder {
  // Comparison — returns ExprBuilder wrapping { type: "compare", ... }
  eq(other: ExprBuilder | Value): ExprBuilder;
  neq(other: ExprBuilder | Value): ExprBuilder;
  gt(other: ExprBuilder | Value): ExprBuilder;
  lt(other: ExprBuilder | Value): ExprBuilder;
  gte(other: ExprBuilder | Value): ExprBuilder;
  lte(other: ExprBuilder | Value): ExprBuilder;

  // Arithmetic — returns ExprBuilder wrapping { type: "arithmetic", ... }
  add(other: ExprBuilder | Value): ExprBuilder;
  sub(other: ExprBuilder | Value): ExprBuilder;
  mul(other: ExprBuilder | Value): ExprBuilder;
  div(other: ExprBuilder | Value): ExprBuilder;

  // Logic — returns ExprBuilder wrapping { type: "logic", ... }
  and(other: ExprBuilder): ExprBuilder;
  or(other: ExprBuilder): ExprBuilder;

  // Extracts the underlying Expr AST node (called by the builder internals)
  toExpr(): Expr;
}
```

When a `Value` (boolean, number, string) is passed where an `ExprBuilder` is expected, it is auto-wrapped in `{ type: "literal", value }`. This is why `setFact("$npc", "key", "repaired")` and `setFact("$npc", "key", fact("x").add(5))` both work — the builder accepts `Value | ExprBuilder` for the value argument.

The `player` object is a proxy that provides:
- `player.prop(name)` — returns `ExprBuilder` wrapping `{ type: "prop_ref", target: "player", prop: name }`
- `player.hasItem(item, amount)` — returns `ExprBuilder` wrapping `{ type: "call", fn: "has_item", args: [literal("$player"), literal(item), amount.toExpr()] }`

Similarly, `npc.prop(name)` and `settlement.prop(name)` are available.

### 3. Evaluator and Executor

#### Evaluator (Pure, No Side Effects)

```typescript
// AgentAccessor: read-only view of an Agent's public state (id, position, inventory, hp, role, faction)
// SettlementAccessor: read-only view of a Settlement's public state (id, inventory, population count)
// Both are thin wrappers that expose properties by string key for prop_ref resolution.

interface EvalContext {
  beliefs: ReadonlyMap<string, Fact>;
  locals: ReadonlyMap<string, Value>;
  agentState: {
    player: AgentAccessor;
    npc: AgentAccessor;
    settlement: SettlementAccessor | null;  // null when NPC is not in a settlement (wandering)
  };
  currentTick: number;
}

function evaluate(expr: Expr, ctx: EvalContext): Value;
  // prop_ref with target "settlement" returns null/0/"" when ctx.agentState.settlement is null
function interpolate(template: TextTemplate, ctx: EvalContext, locale?: Locale): string;
function checkCondition(expr: Expr, ctx: EvalContext): boolean;
```

#### Executor (Applies Effects)

```typescript
interface MutableContext extends EvalContext {
  resolveAgent(ref: AgentRef): Agent;         // resolves "$player", "$npc", IDs
  setFact(ref: AgentRef, key: string, value: Value): void;
  setLocal(key: string, value: Value): void;
  giveItem(ref: AgentRef, item: string, amount: number): void;
  takeItem(ref: AgentRef, item: string, amount: number): boolean;
  damage(ref: AgentRef, amount: number): void;
  registerTrigger(rule: TriggerRule): void;
}

function executeEffects(effects: Effect[], ctx: MutableContext): void;
```

`setFact` automatically fills in `tick` from `ctx.currentTick` and `source` from the acting NPC's agent ID. The `target` field on the `set_fact` effect determines whose `BeliefStore` receives the fact. Typically `"$npc"` (the NPC in the current dialogue), but can target any agent.

**Effect failure policy**: if `take_item` returns false (insufficient items), the remaining effects in the array are **skipped** (short-circuit). Dialogue scripts should guard with a condition (e.g., `.when(player.hasItem(...))`) before reaching an action node with `take_item`. This matches the pattern in the eDSL example where the choice condition gates the action.

Effect handlers are a registry keyed by `Effect["type"]`. Adding a new effect type means adding one handler function.

### 4. Trigger System

```typescript
interface TriggerRule {
  id: string;                     // auto-generated: "scenario:{scenarioId}:{index}" or "rt:{tick}:{index}"
  when: Expr;
  then: Effect[];
  targets: AgentRef[];
  once: boolean;
  source: "scenario" | "runtime";
  fired: boolean;                 // tracks one-shot state
}
```

#### Execution Model: Deferred-Batch

Triggers do **not** fire inline during `set_fact`. Instead, each `set_fact` call records the changed key in a per-tick `changedFacts: Set<string>`. At the end of the tick (step 8 in the tick flow), the trigger registry evaluates all rules whose `when` expression references any key in `changedFacts`. This avoids cascading trigger chains and keeps the execution order deterministic.

If a trigger's `then` effects call `set_fact`, those changes are **not** re-evaluated in the same tick. They become part of the next tick's `changedFacts`. This prevents infinite loops without needing a recursion guard.

#### Target Resolution

`targets` are resolved at **fire time** (not registration time):
- Concrete agent IDs: `"elder_chen"` — resolves to that agent, skipped if dead
- `"$player"` — the player agent who was in the dialogue that registered the trigger (captured at registration time as a concrete ID)
- `"$faction:village_a"` — all living agents in that faction at fire time

For `once: true` triggers, "once" means once per trigger (not per target). After firing, `fired` is set to `true` and the rule is skipped on all subsequent evaluations.

#### Trigger IDs

Scenario-defined triggers get deterministic IDs: `"scenario:{scenarioId}:{index}"`. Runtime-created triggers (via `register_trigger` effect) get `"rt:{currentTick}:{index}"`. The builder auto-generates IDs; script authors do not supply them.

#### Damage via Triggers

`damage` effects from triggers can kill agents (same as `Agent.takeDamage`). The trigger author is responsible for guarding with conditions. No special validation is applied beyond what `Agent.takeDamage` already does.

### 5. Scenario eDSL

Dialogue scripts are authored in TypeScript using a builder API. The builders produce pure data (AST nodes). Executing a scenario file yields a `ScenarioData` JSON object. No builder logic runs at game runtime.

```
scenario.ts  >>>  import & execute builders (build time)  >>>  ScenarioData JSON (runtime)
```

#### ScenarioData Structure

```typescript
interface ScenarioData {
  id: string;
  npcs: NpcDefinition[];
  dialogues: DialogueTreeData[];
  triggers: TriggerRule[];
}

interface NpcDefinition {
  id: string;
  role: string;
  faction: string;
  position: Position;
  initialBeliefs: Array<{ key: string; value: Value }>;  // plain data, not Effect nodes
  dialogueIds: string[];                                   // an NPC can have multiple dialogue trees
}

interface DialogueTreeData {
  id: string;
  root: string;
  nodes: Record<string, DialogueNodeData>;
  triggers: TriggerRule[];  // triggers defined inside this dialogue (hoisted at compile time)
}
```

#### Dialogue Node Data (Compiled)

```typescript
type DialogueNodeData =
  | { type: "text"; speaker: string; content: TextTemplate; next: string }
  | { type: "choice"; options: ChoiceOptionData[] }
  | { type: "request"; label: TextTemplate; gateType: "llm"; nextYes: string; nextNo: string }
  | { type: "action"; effects: Effect[]; next: string }
  | { type: "end" };

interface ChoiceOptionData {
  id: string;
  label: TextTemplate;
  condition?: Expr;
  next: string;
}
```

Note: compared to the current `DialogueNode` type, `content` and `label` change from `string` to `TextTemplate`, `effect` changes from `string` to `Effect[]`, and `condition` changes from `string` to `Expr`.

#### eDSL Example

The builder API uses `@town-zero/shared/script-dsl` (subpath export from the shared package). The `belief()` helper produces `{ key, value }` plain data for `initialBeliefs` (distinct from `setFact()` which produces an `Effect` node). Text nodes without an explicit `next` auto-chain to the next registered node in source order. `d.trigger()` calls are **not** dialogue nodes — they register triggers on the `DialogueTreeData.triggers` array and do not affect auto-chaining. The last node in a dialogue must be an `end` node.

```typescript
import {
  belief, fact, give, local, npc, player,
  scenario, setFact, take, trigger, when, t,
} from "@town-zero/shared/script-dsl";

export default scenario("bridge-crisis", (s) => {
  s.npc("elder_chen", {
    role: "merchant",
    faction: "village_a",
    position: { x: 10, y: 5 },
    initialBeliefs: [
      belief("is_elder", true),        // { key: "is_elder", value: true }
      belief("bridge_status", "intact"),
    ],
  });

  s.npc("scout_lin", {
    role: "scout",
    faction: "village_a",
    position: { x: 15, y: 8 },
    initialBeliefs: [
      belief("patrol_route", "north"),
    ],
  });

  // s.dialogue() binds a dialogue tree to an NPC and adds it to the NPC's dialogueIds.
  // An NPC can have multiple dialogues (e.g., quest dialogue + idle chatter).
  // The first dialogue registered becomes the default.
  s.dialogue("elder_chen", "elder-talk", (d) => {
    // text nodes auto-chain: "greeting" -> next node in source order ("main")
    d.text("greeting",
      t`歡迎，旅人。${fact("last_visitor")} 之前也來過。`);

    d.choice("main", [
      d.option("問橋的狀況")
        .when(fact("bridge_status").neq("intact"))
        .goto("bridge-info"),
      d.option("交易")
        .when(fact("rep_with_player").gt(3))
        .goto("trade"),
      d.option("告辭")
        .goto("farewell"),
    ]);

    // "bridge-info" auto-chains to "bridge-offer"
    d.text("bridge-info",
      t`橋已經 ${fact("bridge_status")} 了。我們需要 ${local("repair_cost")} 個材料修復。`);

    d.choice("bridge-offer", [
      // player.hasItem() compiles to: { type: "call", fn: "has_item",
      //   args: [literal("$player"), literal("material"), local_ref("repair_cost")] }
      d.option(t`我有材料（持有 ${player.prop("material")} 個）`)
        .when(player.hasItem("material", local("repair_cost")))
        .goto("accept-repair"),
      d.option("我去找找看")
        .goto("farewell"),
    ]);

    // action nodes require explicit next
    d.action("accept-repair", [
      take("$player", "material", local("repair_cost")),
      setFact("$npc", "bridge_status", "repaired"),
      setFact("$npc", "rep_with_player", fact("rep_with_player").add(5)),
    ], { next: "thanks" });

    // "thanks" auto-chains to "farewell" (d.trigger is not a node, doesn't break chain)
    d.text("thanks", t`太好了！你真是大恩人。`);

    // Dialogue-scoped trigger: $npc and $player are valid here.
    // $player is captured as a concrete ID when the trigger is registered (during dialogue).
    d.trigger(
      when(fact("bridge_status").eq("repaired")),
      [setFact("$npc", "trade_route_open", true)],
      { targets: ["elder_chen", "scout_lin", "$player"] },
    );

    d.text("farewell", t`一路平安。`);

    d.end("done");
  });

  // Scenario-level trigger: must use concrete agent IDs, not $npc or $player
  // (no dialogue context exists at scenario load time).
  s.trigger(
    when(fact("bridge_status").eq("destroyed")),
    [setFact("elder_chen", "bridge_crisis_active", true)],
    { targets: ["elder_chen", "scout_lin"] },
  );
});
```

**`prop_ref` property resolution**: `AgentAccessor` exposes `ResourceStore` fields directly — `player.prop("food")`, `player.prop("material")`, `player.prop("currency")` map to `agent.inventory[prop]`. Top-level agent fields (`"hp"`, `"role"`, `"faction"`, `"id"`) are also accessible. Invalid property names return `0` for numbers, `""` for strings.

### 6. i18n (Keyless)

Default-locale text written inline in the eDSL serves as both content and translation key. The `TextTemplate` is normalized to a placeholder string for lookup:

```
TextTemplate: ["歡迎，旅人。", {fact_ref: "last_visitor"}, " 之前也來過。"]
Normalized key: "歡迎，旅人。{0} 之前也來過。"
```

Locale files map normalized keys to translated templates:

```jsonc
// locale/en.json
{
  "歡迎，旅人。{0} 之前也來過。": "Welcome, traveler. {0} was here before."
}
```

Runtime resolution:
1. Normalize the default `TextTemplate` to a key string (text with `{0}`, `{1}`, ... placeholders)
2. Look up the key in the current locale file
3. If found, parse the translated string back into a `TextTemplate` (re-inserting the original `Expr` nodes at `{0}`, `{1}`, ... positions)
4. If not found, use the default `TextTemplate` as-is

For disambiguation (same text, different meaning), an optional context parameter appends `@@context` to the key:

```typescript
d.text("node1", t`你好`, { context: "formal_greeting" });
// key: "你好@@formal_greeting"
```

Choice option labels follow the same keyless pattern.

### 7. LLM Prompt Integration

The existing `PromptBuilder` is extended to serialize an agent's `BeliefStore` into the prompt:

```
=== What you know (beliefs) ===
- bridge_status: destroyed (learned tick 1042 from scout_lin)
- rep_with_player: 7 (your own assessment, tick 1038)
- trade_route_open: false (learned tick 1050 from elder_chen)
```

This gives LLM-controlled NPCs access to propagated narrative state when making decisions.

The `DialogueGate` (`evaluateDialogueGate`) currently takes `requestLabel: string`. After migration, `request` nodes have `label: TextTemplate`. The gate must interpolate the template before sending to the LLM: `interpolate(node.label, ctx)` produces the plain string for the prompt.

### 8. Updated Tick Flow

Matches the existing `processTick` phase numbering in `server/src/simulation/tick.ts`:

```
Per tick (1s):
  Phase 1:   Process ongoing multi-tick actions (gathering, fighting)
  Phase 2:   Dequeue and execute next command for idle agents
  Phase 2.5: Bot controller decides for idle bot agents
  Phase 3:   Production
  Phase 4:   Consumption
  Phase 5:   Merchant movement and spawning
  Phase 6:   Vision update (MapMemory per agent)
  Phase 7:   Memory merge: MapMemory + BeliefStore (adjacent same-faction)  [EXTENDED]
  Phase 8:   Trigger evaluation (deferred-batch, process changedFacts set)  [NEW]
```

Phase 7 extends the existing `mergeAdjacentMemories` to also call `mergeBeliefs`. Phase 8 is a new phase added after merge: collect all fact keys changed during this tick, evaluate trigger conditions, fire matching triggers.

### 9. Client Interaction Protocol (Server-Side Only)

Client-side dialogue UI is a separate spec. This section defines what the **server** must provide so the client can be built independently.

#### Dialogue Initiation

The existing `ActionCommand` has `{ type: "talk"; targetId: string; optionId: string }`. The system has no facing direction — agents only have `position: { x, y }`. Dialogue target selection is the client's responsibility (e.g., pick the nearest adjacent NPC). The server validates that the target NPC is adjacent and alive.

When the server receives a `talk` command:
1. Validate: target NPC exists, is alive, is adjacent to player, and is not already in a dialogue with another player
2. Set both agents' FSM state to `"talking"`
3. Create a `DialogueEngine` for this NPC-player pair
4. Build `EvalContext` with NPC's beliefs as POV
5. Evaluate the root node → produce a `DialogueStateMessage`
6. Send `DialogueStateMessage` to the client via Colyseus `send()`

#### Server → Client Message: `dialogue:state`

```typescript
interface DialogueStateMessage {
  treeId: string;
  nodeId: string;
  type: "text" | "choice" | "request_pending" | "end";
  speaker: string;
  text: string;               // fully interpolated, plain string — client never sees AST
  options?: Array<{           // only for "choice" type, already filtered by conditions
    id: string;
    label: string;            // fully interpolated
  }>;
}
```

The server performs all interpolation, condition filtering, and effect execution. The client receives only pre-rendered text and visible options. No `Expr`, `TextTemplate`, or `Fact` data is sent to the client.

#### Client → Server Messages

- `dialogue:advance` `{}` — player presses "continue" on a text node
- `dialogue:select` `{ optionId: string }` — player picks a choice option
- `dialogue:cancel` `{}` — player closes dialogue early

#### Session Management

- Server maintains a `Map<string, DialogueEngine>` keyed by player session ID
- One NPC can only be in dialogue with one player at a time. Other players see the NPC's state as `"talking"`
- On `dialogue:cancel` or client disconnect: clean up engine, set both agents back to `"idle"`
- On `request` node (LLM gate): server sends `type: "request_pending"`, calls LLM, then sends the result node automatically. Client shows a waiting indicator

#### DialogueProgressEntry Updates

When a dialogue session ends (reaches `"end"` node or is cancelled), the server persists the `DialogueProgressEntry` on the NPC agent:
- Append visited node IDs
- Record selected options
- Persist dialogue locals

This allows the next conversation with the same NPC to resume from different branches.

### 10. Serialization Constraint

All AST nodes, `Fact`, `BeliefStore`, `DialogueProgressEntry`, `TriggerRule`, and `ScenarioData` must be JSON-serializable. Tests verify round-trip:

```typescript
const data = compileScenario(scenarioFn);
expect(JSON.parse(JSON.stringify(data))).toEqual(data);
```

This constraint applies to both static scenario data and runtime-created structures (dynamic triggers, belief stores, dialogue progress). The save/load system itself is not implemented, but the data structures are proven serializable.

### 11. Migration from Current Dialogue Types

The existing types in `shared/src/types.ts` evolve:

| Current | New |
|---------|-----|
| `content: string` | `content: TextTemplate` |
| `label: string` (choice) | `label: TextTemplate` |
| `condition?: string` | `condition?: Expr` |
| `effect: string` | `effects: Effect[]` |
| `defaultLocals?: Record<string, unknown>` | Removed (replaced by `DialogueProgressEntry.locals`) |

The existing `DialogueEngine` is refactored to use the evaluator for conditions and the executor for effects, replacing the current no-op behavior. The `villager-basic.json` example tree is rewritten as a scenario eDSL file.

## Package Layout

The eDSL builders live in `shared/` with a subpath export (`@town-zero/shared/script-dsl`), configured in `shared/package.json` `"exports"` field. This allows both build-time compilation tools and (eventually) client-side tooling to import them. The evaluator and executor live in `server/` since they are authoritative server-side logic.

```
shared/
  package.json         -- add "exports": { "./script-dsl": "./src/script-dsl/index.ts" }
  src/
    types.ts           -- Expr, Effect, TextTemplate, TriggerRule, Fact, Value, etc.
    script-dsl/        -- eDSL builder API
      index.ts         -- re-exports: scenario, dialogue, fact, belief, t, etc.
      builders.ts      -- scenario/dialogue/npc builder functions
      template.ts      -- tagged template literal `t`
      expressions.ts   -- fact(), local(), player proxy, comparison chain builders

server/
  src/
    dialogue/
      dialogue-engine.ts   -- refactored to use evaluator/executor
      evaluator.ts         -- evaluate(), interpolate(), checkCondition()
      executor.ts          -- executeEffects(), effect handler registry
      trigger-registry.ts  -- TriggerRegistry, deferred-batch evaluation
      dialogue-gate.ts     -- interpolates TextTemplate label, includes beliefs in prompt
    simulation/
      agent.ts             -- +beliefs: Map<string, Fact>, +dialogueProgress
      scenarios/           -- compiled ScenarioData JSON files
    ai/
      prompt-builder.ts    -- +belief serialization section
```
