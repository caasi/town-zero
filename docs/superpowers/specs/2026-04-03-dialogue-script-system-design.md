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
// On Agent class
beliefs: Map<string, Fact>
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
// On Agent class
dialogueProgress: Map<string, DialogueProgressEntry>

interface DialogueProgressEntry {
  visitedNodes: Set<string>;
  selectedOptions: Map<string, string>;  // nodeId -> optionId
  locals: Map<string, boolean | number | string>;
}
```

This tracks which dialogue branches have been explored with each NPC and persists across conversations. It does not propagate to other agents.

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
  | { type: "set_fact"; key: string; value: Expr }
  | { type: "set_local"; key: string; value: Expr }
  | { type: "give_item"; target: AgentRef; item: string; amount: Expr }
  | { type: "take_item"; target: AgentRef; item: string; amount: Expr }
  | { type: "damage"; target: AgentRef; amount: Expr }
  | { type: "register_trigger"; trigger: TriggerRule };
```

#### Text Template

```typescript
type TextTemplate = Array<string | Expr>;
```

A template like `"你有 {player.food} 個食物"` compiles to:

```json
["你有 ", { "type": "prop_ref", "target": "player", "prop": "food" }, " 個食物"]
```

#### White-Listed Functions

The `call` expression node can invoke these functions:

- `has_item(target, item)` returns boolean
- `count_item(target, item)` returns number
- `distance(a, b)` returns number
- `faction_of(agent)` returns string

New functions are added by extending the function registry, not the evaluator.

### 3. Evaluator and Executor

#### Evaluator (Pure, No Side Effects)

```typescript
interface EvalContext {
  beliefs: ReadonlyMap<string, Fact>;
  locals: ReadonlyMap<string, Value>;
  agentState: {
    player: AgentAccessor;
    npc: AgentAccessor;
    settlement?: SettlementAccessor;
  };
  currentTick: number;
}

function evaluate(expr: Expr, ctx: EvalContext): Value;
function interpolate(template: TextTemplate, ctx: EvalContext, locale?: Locale): string;
function checkCondition(expr: Expr, ctx: EvalContext): boolean;
```

#### Executor (Applies Effects)

```typescript
interface MutableContext extends EvalContext {
  setFact(agentId: string, key: string, value: Value, tick: number): void;
  setLocal(key: string, value: Value): void;
  giveItem(target: string, item: string, amount: number): void;
  takeItem(target: string, item: string, amount: number): boolean;
  damage(target: string, amount: number): void;
  registerTrigger(rule: TriggerRule): void;
}

function executeEffects(effects: Effect[], ctx: MutableContext): void;
```

Effect handlers are a registry keyed by `Effect["type"]`. Adding a new effect type means adding one handler function.

### 4. Trigger System

```typescript
interface TriggerRule {
  id: string;
  when: Expr;
  then: Effect[];
  targets: AgentRef[];
  once: boolean;
  source: "scenario" | "runtime";
}
```

Triggers fire **reactively** when a fact changes (inside `set_fact`), not by polling every tick. On each `set_fact` call, the trigger registry scans rules whose `when` expression references the changed fact key. If the condition evaluates to true, the `then` effects execute for each agent in `targets`.

`targets` supports:
- Concrete agent IDs: `"elder_chen"`
- Special references: `"$player"` (current dialogue player), `"$faction:village_a"` (all agents in faction)

One-shot triggers (`once: true`) are marked as fired and skipped on subsequent evaluations. Scenario-defined triggers reset on scenario reload; runtime-created triggers persist until the world resets.

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
  initialBeliefs: Array<{ key: string; value: Value }>;
  dialogueId: string;
}

interface DialogueTreeData {
  id: string;
  root: string;
  nodes: Record<string, DialogueNodeData>;
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

```typescript
import {
  scenario, dialogue, fact, local, player,
  setFact, setLocal, give, take, when, t,
} from "@town-zero/script-dsl";

export default scenario("bridge-crisis", (s) => {
  s.npc("elder_chen", {
    role: "merchant",
    faction: "village_a",
    position: { x: 10, y: 5 },
    initialBeliefs: [
      setFact("is_elder", true),
      setFact("bridge_status", "intact"),
    ],
  });

  s.npc("scout_lin", {
    role: "scout",
    faction: "village_a",
    position: { x: 15, y: 8 },
    initialBeliefs: [
      setFact("patrol_route", "north"),
    ],
  });

  s.dialogue("elder_chen", "elder-talk", (d) => {
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

    d.text("bridge-info",
      t`橋已經 ${fact("bridge_status")} 了。我們需要 ${local("repair_cost")} 木材修復。`);

    d.choice("bridge-offer", [
      d.option(t`我有木材（持有 ${player.prop("wood")} 個）`)
        .when(player.hasItem("wood", local("repair_cost")))
        .goto("accept-repair"),
      d.option("我去找找看")
        .goto("farewell"),
    ]);

    d.action("accept-repair", [
      take("player", "wood", local("repair_cost")),
      setFact("bridge_status", "repaired"),
      setFact("rep_with_player", fact("rep_with_player").add(5)),
    ], { next: "thanks" });

    d.text("thanks", t`太好了！你真是大恩人。`);

    d.trigger(
      when(fact("bridge_status").eq("repaired")),
      [setFact("trade_route_open", true)],
      { targets: ["elder_chen", "scout_lin", "$player"] },
    );

    d.text("farewell", t`一路平安。`);
    d.end("farewell");
  });

  s.trigger(
    when(fact("bridge_status").eq("destroyed")),
    [setFact("bridge_crisis_active", true)],
    { targets: ["elder_chen", "scout_lin"] },
  );
});
```

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

This gives LLM-controlled NPCs access to propagated narrative state when making decisions. The `DialogueGate` prompt similarly includes relevant beliefs for y/n decisions.

### 8. Updated Tick Flow

```
Per tick (1s):
  1. Process ongoing multi-tick actions
  2. Dequeue and execute next command from each agent's plan
  3. Bot controller decides for idle bot agents
  4. Production facilities convert raw materials
  5. Agents consume food (starvation -> HP loss -> death)
  6. Merchant spawning and movement
  7. Vision update (MapMemory per agent)
  8. Memory merge: MapMemory + BeliefStore (adjacent same-faction)  [EXTENDED]
  9. Trigger evaluation (reactive, on fact changes during this tick) [NEW]
```

### 9. Serialization Constraint

All AST nodes, `Fact`, `BeliefStore`, `DialogueProgressEntry`, `TriggerRule`, and `ScenarioData` must be JSON-serializable. Tests verify round-trip:

```typescript
const data = compileScenario(scenarioFn);
expect(JSON.parse(JSON.stringify(data))).toEqual(data);
```

This constraint applies to both static scenario data and runtime-created structures (dynamic triggers, belief stores, dialogue progress). The save/load system itself is not implemented, but the data structures are proven serializable.

### 10. Migration from Current Dialogue Types

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

```
shared/
  src/
    types.ts           -- Expr, Effect, TextTemplate, TriggerRule, Fact, etc.
    script-dsl/        -- eDSL builder API (scenario, dialogue, fact, etc.)
      index.ts
      builders.ts
      template.ts      -- tagged template literal `t`

server/
  src/
    dialogue/
      dialogue-engine.ts   -- refactored to use evaluator/executor
      evaluator.ts         -- evaluate(), interpolate(), checkCondition()
      executor.ts          -- executeEffects(), effect handler registry
      trigger-registry.ts  -- TriggerRegistry, reactive evaluation
      dialogue-gate.ts     -- extended prompt includes beliefs
    simulation/
      agent.ts             -- +beliefs, +dialogueProgress
      scenarios/           -- compiled ScenarioData JSON files
    ai/
      prompt-builder.ts    -- +belief serialization
```

The eDSL builders live in `shared/` so that both build-time compilation tools and (eventually) client-side tooling can import them. The evaluator and executor live in `server/` since they are authoritative server-side logic.
