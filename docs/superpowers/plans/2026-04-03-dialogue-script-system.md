# Dialogue Script System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dialogue scripting system with dynamic facts, belief propagation, expression evaluation, side effects, trigger rules, and a TypeScript eDSL for authoring scenarios.

**Architecture:** Bottom-up: define AST types in shared → build eDSL builders in shared → implement evaluator/executor on server → extend Agent with beliefs → wire into tick loop and dialogue engine. All runtime data is pure JSON-serializable AST; no JS eval.

**Tech Stack:** TypeScript (strict), pnpm workspaces (`shared/`, `server/`), Vitest, Colyseus 0.17.x

**Spec:** `docs/superpowers/specs/2026-04-03-dialogue-script-system-design.md`

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `shared/src/script-types.ts` | AST types: `Expr`, `Effect`, `TextTemplate`, `Fact`, `TriggerRule`, `Value`, `AgentRef`, `ScenarioData`, `NpcDefinition`, `DialogueTreeData`, `DialogueNodeData`, `ChoiceOptionData`, `DialogueProgressEntry` |
| `shared/src/script-dsl/index.ts` | Re-exports all public eDSL symbols |
| `shared/src/script-dsl/expressions.ts` | `ExprBuilder` class, `fact()`, `local()`, `player`/`npc`/`settlement` proxies |
| `shared/src/script-dsl/template.ts` | Tagged template literal `t` |
| `shared/src/script-dsl/builders.ts` | `scenario()`, `belief()`, `setFact()`, `give()`, `take()`, `damage()`, `when()` builders |
| `server/src/dialogue/evaluator.ts` | `evaluate()`, `interpolate()`, `checkCondition()`, `normalizeTemplateKey()`, `resolveLocale()` |
| `server/src/dialogue/executor.ts` | `executeEffects()`, effect handler registry, `MutableContext` |
| `server/src/dialogue/trigger-registry.ts` | `TriggerRegistry` class — register, track changedFacts, evaluate batch |
| `server/src/simulation/scenario-loader.ts` | `loadScenario()` — spawn NPCs, inject beliefs, register triggers |
| `server/test/dialogue/evaluator.test.ts` | Evaluator tests |
| `server/test/dialogue/executor.test.ts` | Executor tests |
| `server/test/dialogue/trigger-registry.test.ts` | Trigger system tests |
| `server/test/script-dsl/expressions.test.ts` | ExprBuilder tests |
| `server/test/script-dsl/template.test.ts` | Tagged template tests |
| `server/test/script-dsl/builders.test.ts` | Scenario/dialogue builder tests |
| `server/test/script-dsl/serialization.test.ts` | JSON round-trip tests |
| `server/test/simulation/beliefs.test.ts` | Belief merge + propagation tests |
| `server/test/simulation/scenario-loader.test.ts` | Scenario loading tests |
| `server/test/integration-dialogue.test.ts` | End-to-end dialogue + belief + trigger test |

### Modified files

| File | Changes |
|------|---------|
| `shared/src/types.ts` | Remove old `DialogueNode`, `DialogueChoice`, `DialogueTree` types (replaced by `script-types.ts`). Keep all other types. |
| `shared/src/index.ts` | Re-export from `script-types.ts` |
| `shared/package.json` | Add `"exports"` field with `"./script-dsl"` subpath |
| `server/src/simulation/agent.ts` | Add `beliefs: Map<string, Fact>`, `dialogueProgress: Map<string, DialogueProgressEntry>`, `mergeBeliefs()`, belief serialization helpers |
| `server/src/simulation/vision.ts` | Extend `mergeAdjacentMemories()` to also merge beliefs |
| `server/src/simulation/tick.ts` | Add Phase 8: trigger evaluation |
| `server/src/dialogue/dialogue-engine.ts` | Refactor to use evaluator for conditions, executor for effects, interpolate for text |
| `server/src/dialogue/dialogue-gate.ts` | Interpolate `TextTemplate` label, add beliefs to prompt |
| `server/src/ai/prompt-builder.ts` | Add beliefs serialization section |
| `server/test/dialogue/dialogue-engine.test.ts` | Update tests for new AST-based nodes |
| `server/test/dialogue/dialogue-gate.test.ts` | Update tests for TextTemplate interpolation |

---

## Tasks

### Task 1: AST types in shared

**Files:**
- Create: `shared/src/script-types.ts`
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Write the type file**

Create `shared/src/script-types.ts` with all AST types from the spec:

```typescript
import type { ResourceType, Position } from "./types.js";

// --- Values ---

export type Value = boolean | number | string;

// --- Expressions ---

export type Expr =
  | { type: "literal"; value: Value }
  | { type: "fact_ref"; key: string }
  | { type: "local_ref"; key: string }
  | { type: "prop_ref"; target: "player" | "npc" | "settlement"; prop: string }
  | { type: "compare"; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte"; left: Expr; right: Expr }
  | { type: "logic"; op: "and" | "or" | "not"; args: Expr[] }
  | { type: "call"; fn: string; args: Expr[] }
  | { type: "arithmetic"; op: "add" | "sub" | "mul" | "div"; left: Expr; right: Expr };

// --- Text Templates ---

export type TextTemplate = Array<string | Expr>;

// --- Agent References ---

export type AgentRef = string; // agent ID, "$player", "$npc", "$faction:xxx"

// --- Effects ---

export type Effect =
  | { type: "set_fact"; target: AgentRef; key: string; value: Expr }
  | { type: "set_local"; key: string; value: Expr }
  | { type: "give_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "take_item"; target: AgentRef; item: ResourceType; amount: Expr }
  | { type: "damage"; target: AgentRef; amount: Expr }
  | { type: "register_trigger"; trigger: TriggerRule };

// --- Facts & Beliefs ---

export interface Fact {
  key: string;
  value: Value;
  tick: number;
  source: string; // agent ID who originated this fact
}

// --- Dialogue Progress ---

export interface DialogueProgressEntry {
  visitedNodes: string[];
  selectedOptions: Record<string, string>;
  locals: Record<string, Value>;
}

// --- Triggers ---

export interface TriggerRule {
  id: string;
  when: Expr;
  then: Effect[];
  targets: AgentRef[];
  once: boolean;
  source: "scenario" | "runtime";
  fired: boolean;
}

// --- Dialogue Nodes (Compiled) ---

export type DialogueNodeData =
  | { type: "text"; speaker: string; content: TextTemplate; next: string }
  | { type: "choice"; options: ChoiceOptionData[] }
  | { type: "request"; label: TextTemplate; gateType: "llm"; nextYes: string; nextNo: string }
  | { type: "action"; effects: Effect[]; next: string }
  | { type: "end" };

export interface ChoiceOptionData {
  id: string;
  label: TextTemplate;
  condition?: Expr;
  next: string;
}

export interface DialogueTreeData {
  id: string;
  root: string;
  nodes: Record<string, DialogueNodeData>;
  triggers: TriggerRule[];
}

// --- Scenario ---

export interface NpcDefinition {
  id: string;
  role: string;
  faction: string;
  position: Position;
  initialBeliefs: Array<{ key: string; value: Value }>;
  dialogueIds: string[];
}

export interface ScenarioData {
  id: string;
  npcs: NpcDefinition[];
  dialogues: DialogueTreeData[];
  triggers: TriggerRule[];
}
```

- [ ] **Step 2: Update shared/src/index.ts**

Add re-export at the end of `shared/src/index.ts`:

```typescript
export * from "./script-types.js";
```

- [ ] **Step 3: Remove old dialogue types from shared/src/types.ts**

Remove `DialogueNodeId`, `DialogueNode`, `DialogueChoice`, `DialogueTree` types from `shared/src/types.ts`. These are replaced by the new types in `script-types.ts`. Keep all other types (ResourceType, Position, ActionCommand, TileMemory, etc.).

- [ ] **Step 4: Build shared to verify no type errors**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/shared build`
Expected: Clean build, no errors.

- [ ] **Step 5: Fix any downstream compilation errors**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run build`

The server imports `DialogueTree` and `DialogueNode` from `@town-zero/shared`. These references need updating in:
- `server/src/dialogue/dialogue-engine.ts` — change import to use `DialogueTreeData` and `DialogueNodeData`
- `server/test/dialogue/dialogue-engine.test.ts` — update test tree to use new node types

For now, make the existing code compile with the new types. The full refactor happens in Task 8.

The existing `DialogueEngine` constructor takes `DialogueTree`. Change it to take `DialogueTreeData` temporarily. Adapt `text` nodes to use `TextTemplate` (wrap existing `string` content as `[content]` single-element array). Adapt `action` nodes to use `effects: Effect[]` (replace `effect: string` with `effects: []` empty array for now). Adapt `choice` options to use `ChoiceOptionData` shape (add `id` field, wrap `label` as `TextTemplate`).

Update `villager-basic.json` to match the new `DialogueTreeData` shape (add `triggers: []`, convert node fields).

- [ ] **Step 6: Run all tests to verify nothing is broken**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add shared/src/script-types.ts shared/src/index.ts shared/src/types.ts server/src/dialogue/dialogue-engine.ts server/test/dialogue/dialogue-engine.test.ts server/src/dialogue/trees/villager-basic.json
git commit -m "feat(shared): add AST types for dialogue script system

Introduce Expr, Effect, TextTemplate, Fact, TriggerRule, ScenarioData,
and related types. Migrate existing DialogueEngine to new type shapes."
```

---

### Task 2: ExprBuilder and expression primitives

**Files:**
- Create: `shared/src/script-dsl/expressions.ts`
- Create: `server/test/script-dsl/expressions.test.ts`

- [ ] **Step 1: Write failing tests for ExprBuilder**

Create `server/test/script-dsl/expressions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fact, local, player, npc, settlement } from "@town-zero/shared/script-dsl";

describe("ExprBuilder", () => {
  describe("fact()", () => {
    it("creates a fact_ref node", () => {
      const expr = fact("bridge_status").toExpr();
      expect(expr).toEqual({ type: "fact_ref", key: "bridge_status" });
    });

    it("chains .eq() to produce compare node", () => {
      const expr = fact("x").eq(5).toExpr();
      expect(expr).toEqual({
        type: "compare",
        op: "eq",
        left: { type: "fact_ref", key: "x" },
        right: { type: "literal", value: 5 },
      });
    });

    it("chains .neq() with string", () => {
      const expr = fact("status").neq("intact").toExpr();
      expect(expr).toEqual({
        type: "compare",
        op: "neq",
        left: { type: "fact_ref", key: "status" },
        right: { type: "literal", value: "intact" },
      });
    });

    it("chains .gt() with number", () => {
      const expr = fact("rep").gt(3).toExpr();
      expect(expr.type).toBe("compare");
      if (expr.type === "compare") {
        expect(expr.op).toBe("gt");
      }
    });

    it("chains .add() to produce arithmetic node", () => {
      const expr = fact("rep").add(5).toExpr();
      expect(expr).toEqual({
        type: "arithmetic",
        op: "add",
        left: { type: "fact_ref", key: "rep" },
        right: { type: "literal", value: 5 },
      });
    });

    it("chains .and() for logic", () => {
      const expr = fact("a").eq(1).and(fact("b").eq(2)).toExpr();
      expect(expr.type).toBe("logic");
      if (expr.type === "logic") {
        expect(expr.op).toBe("and");
        expect(expr.args).toHaveLength(2);
      }
    });
  });

  describe("local()", () => {
    it("creates a local_ref node", () => {
      const expr = local("repair_cost").toExpr();
      expect(expr).toEqual({ type: "local_ref", key: "repair_cost" });
    });
  });

  describe("player proxy", () => {
    it("player.prop() creates prop_ref", () => {
      const expr = player.prop("food").toExpr();
      expect(expr).toEqual({ type: "prop_ref", target: "player", prop: "food" });
    });

    it("player.hasItem() creates call node", () => {
      const expr = player.hasItem("material", local("cost")).toExpr();
      expect(expr).toEqual({
        type: "call",
        fn: "has_item",
        args: [
          { type: "literal", value: "$player" },
          { type: "literal", value: "material" },
          { type: "local_ref", key: "cost" },
        ],
      });
    });
  });

  describe("npc proxy", () => {
    it("npc.prop() creates prop_ref with target npc", () => {
      const expr = npc.prop("hp").toExpr();
      expect(expr).toEqual({ type: "prop_ref", target: "npc", prop: "hp" });
    });
  });

  describe("settlement proxy", () => {
    it("settlement.prop() creates prop_ref", () => {
      const expr = settlement.prop("food").toExpr();
      expect(expr).toEqual({ type: "prop_ref", target: "settlement", prop: "food" });
    });
  });

  describe("ExprBuilder accepts ExprBuilder args", () => {
    it("comparison with ExprBuilder rhs", () => {
      const expr = fact("a").gt(fact("b")).toExpr();
      expect(expr).toEqual({
        type: "compare",
        op: "gt",
        left: { type: "fact_ref", key: "a" },
        right: { type: "fact_ref", key: "b" },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/expressions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the ExprBuilder implementation**

Create `shared/src/script-dsl/expressions.ts`:

```typescript
import type { Expr, Value } from "../script-types.js";

export type ExprOrValue = ExprBuilder | Value;

function toExpr(v: ExprOrValue): Expr {
  if (v instanceof ExprBuilder) return v.toExpr();
  return { type: "literal", value: v };
}

export class ExprBuilder {
  constructor(private readonly expr: Expr) {}

  toExpr(): Expr {
    return this.expr;
  }

  // --- Comparison ---
  eq(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "eq", left: this.expr, right: toExpr(other) });
  }
  neq(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "neq", left: this.expr, right: toExpr(other) });
  }
  gt(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "gt", left: this.expr, right: toExpr(other) });
  }
  lt(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "lt", left: this.expr, right: toExpr(other) });
  }
  gte(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "gte", left: this.expr, right: toExpr(other) });
  }
  lte(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "compare", op: "lte", left: this.expr, right: toExpr(other) });
  }

  // --- Arithmetic ---
  add(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "add", left: this.expr, right: toExpr(other) });
  }
  sub(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "sub", left: this.expr, right: toExpr(other) });
  }
  mul(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "mul", left: this.expr, right: toExpr(other) });
  }
  div(other: ExprOrValue): ExprBuilder {
    return new ExprBuilder({ type: "arithmetic", op: "div", left: this.expr, right: toExpr(other) });
  }

  // --- Logic ---
  and(other: ExprBuilder): ExprBuilder {
    return new ExprBuilder({ type: "logic", op: "and", args: [this.expr, other.toExpr()] });
  }
  or(other: ExprBuilder): ExprBuilder {
    return new ExprBuilder({ type: "logic", op: "or", args: [this.expr, other.toExpr()] });
  }
}

// --- Factory functions ---

export function fact(key: string): ExprBuilder {
  return new ExprBuilder({ type: "fact_ref", key });
}

export function local(key: string): ExprBuilder {
  return new ExprBuilder({ type: "local_ref", key });
}

// --- Agent proxies ---

interface AgentProxy {
  prop(name: string): ExprBuilder;
  hasItem(item: string, amount: ExprOrValue): ExprBuilder;
}

function createAgentProxy(target: "player" | "npc" | "settlement", refString: string): AgentProxy {
  return {
    prop(name: string): ExprBuilder {
      return new ExprBuilder({ type: "prop_ref", target, prop: name });
    },
    hasItem(item: string, amount: ExprOrValue): ExprBuilder {
      return new ExprBuilder({
        type: "call",
        fn: "has_item",
        args: [
          { type: "literal", value: refString },
          { type: "literal", value: item },
          toExpr(amount),
        ],
      });
    },
  };
}

export const player: AgentProxy = createAgentProxy("player", "$player");
export const npc: AgentProxy = createAgentProxy("npc", "$npc");
export const settlement: AgentProxy = createAgentProxy("settlement", "$settlement");
```

- [ ] **Step 4: Create the index file and configure subpath export**

Create `shared/src/script-dsl/index.ts`:

```typescript
export { ExprBuilder, fact, local, player, npc, settlement } from "./expressions.js";
export type { ExprOrValue } from "./expressions.js";
```

Update `shared/package.json` to add the `"exports"` field. The existing `"main"` and `"types"` fields stay for the default import. Add:

```json
{
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./script-dsl": {
      "import": "./src/script-dsl/index.ts",
      "types": "./src/script-dsl/index.ts"
    }
  }
}
```

Note: The script-dsl subpath points to `.ts` source files (not `dist/`) because the server uses `tsx` which handles TS directly. If build issues arise, switch to `dist/` and add a build step.

- [ ] **Step 5: Build shared and run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/shared build && pnpm --filter @town-zero/server exec vitest run test/script-dsl/expressions.test.ts`
Expected: All tests pass.

If the subpath export doesn't resolve, try importing directly: `import { fact } from "../../../shared/src/script-dsl/index.js"` in the test as a fallback, and adjust the subpath export config.

- [ ] **Step 6: Commit**

```bash
git add shared/src/script-dsl/ shared/package.json server/test/script-dsl/expressions.test.ts
git commit -m "feat(shared): add ExprBuilder and expression primitives for eDSL"
```

---

### Task 3: Tagged template literal `t`

**Files:**
- Create: `shared/src/script-dsl/template.ts`
- Create: `server/test/script-dsl/template.test.ts`
- Modify: `shared/src/script-dsl/index.ts`

- [ ] **Step 1: Write failing tests**

Create `server/test/script-dsl/template.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { t, fact, player, local } from "@town-zero/shared/script-dsl";

describe("tagged template t", () => {
  it("plain string produces single-element array", () => {
    const tpl = t`Hello world`;
    expect(tpl).toEqual(["Hello world"]);
  });

  it("interpolates ExprBuilder into TextTemplate", () => {
    const tpl = t`Hello ${fact("name")}!`;
    expect(tpl).toEqual([
      "Hello ",
      { type: "fact_ref", key: "name" },
      "!",
    ]);
  });

  it("multiple interpolations", () => {
    const tpl = t`${player.prop("food")} food and ${local("cost")} cost`;
    expect(tpl).toEqual([
      "",
      { type: "prop_ref", target: "player", prop: "food" },
      " food and ",
      { type: "local_ref", key: "cost" },
      " cost",
    ]);
  });

  it("filters out empty strings at start/end", () => {
    const tpl = t`Hello world`;
    // No empty strings should be in the array
    expect(tpl.every((part) => part !== "")).toBe(true);
  });

  it("adjacent expressions have empty string between them", () => {
    const tpl = t`${fact("a")}${fact("b")}`;
    expect(tpl).toEqual([
      { type: "fact_ref", key: "a" },
      { type: "fact_ref", key: "b" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tagged template**

Create `shared/src/script-dsl/template.ts`:

```typescript
import type { TextTemplate, Expr } from "../script-types.js";
import { ExprBuilder } from "./expressions.js";

export function t(strings: TemplateStringsArray, ...values: Array<ExprBuilder | string | number>): TextTemplate {
  const result: TextTemplate = [];
  for (let i = 0; i < strings.length; i++) {
    if (strings[i] !== "") {
      result.push(strings[i]);
    }
    if (i < values.length) {
      const val = values[i];
      if (val instanceof ExprBuilder) {
        result.push(val.toExpr());
      } else {
        // Primitive values become literal expressions for interpolation
        result.push({ type: "literal", value: val } as Expr);
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Add to index.ts**

Add to `shared/src/script-dsl/index.ts`:

```typescript
export { t } from "./template.js";
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/template.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src/script-dsl/template.ts shared/src/script-dsl/index.ts server/test/script-dsl/template.test.ts
git commit -m "feat(shared): add tagged template literal t for TextTemplate"
```

---

### Task 4: Scenario and dialogue builders

**Files:**
- Create: `shared/src/script-dsl/builders.ts`
- Create: `server/test/script-dsl/builders.test.ts`
- Modify: `shared/src/script-dsl/index.ts`

- [ ] **Step 1: Write failing tests for builders**

Create `server/test/script-dsl/builders.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  scenario, belief, setFact, give, take, damage, when, fact, local, player, t,
} from "@town-zero/shared/script-dsl";

describe("builders", () => {
  describe("belief()", () => {
    it("creates plain { key, value } data", () => {
      expect(belief("is_elder", true)).toEqual({ key: "is_elder", value: true });
    });
  });

  describe("setFact()", () => {
    it("creates set_fact effect with literal value", () => {
      const effect = setFact("$npc", "bridge_status", "repaired");
      expect(effect).toEqual({
        type: "set_fact",
        target: "$npc",
        key: "bridge_status",
        value: { type: "literal", value: "repaired" },
      });
    });

    it("creates set_fact effect with ExprBuilder value", () => {
      const effect = setFact("$npc", "rep", fact("rep").add(5));
      expect(effect.type).toBe("set_fact");
      if (effect.type === "set_fact") {
        expect(effect.value.type).toBe("arithmetic");
      }
    });
  });

  describe("give()", () => {
    it("creates give_item effect", () => {
      const effect = give("$player", "food", 3);
      expect(effect).toEqual({
        type: "give_item",
        target: "$player",
        item: "food",
        amount: { type: "literal", value: 3 },
      });
    });
  });

  describe("take()", () => {
    it("creates take_item effect with ExprBuilder amount", () => {
      const effect = take("$player", "material", local("cost"));
      expect(effect).toEqual({
        type: "take_item",
        target: "$player",
        item: "material",
        amount: { type: "local_ref", key: "cost" },
      });
    });
  });

  describe("damage()", () => {
    it("creates damage effect", () => {
      const effect = damage("$npc", 10);
      expect(effect).toEqual({
        type: "damage",
        target: "$npc",
        amount: { type: "literal", value: 10 },
      });
    });
  });

  describe("when()", () => {
    it("unwraps ExprBuilder to Expr", () => {
      const expr = when(fact("x").eq(true));
      expect(expr).toEqual({
        type: "compare",
        op: "eq",
        left: { type: "fact_ref", key: "x" },
        right: { type: "literal", value: true },
      });
    });
  });

  describe("scenario()", () => {
    it("builds a complete ScenarioData", () => {
      const data = scenario("test-scenario", (s) => {
        s.npc("npc_a", {
          role: "merchant",
          faction: "village_a",
          position: { x: 0, y: 0 },
          initialBeliefs: [belief("is_elder", true)],
        });

        s.dialogue("npc_a", "talk", (d) => {
          d.text("greeting", t`Hello`);
          d.end("done");
        });

        s.trigger(
          when(fact("x").eq(1)),
          [setFact("npc_a", "y", true)],
          { targets: ["npc_a"] },
        );
      });

      expect(data.id).toBe("test-scenario");
      expect(data.npcs).toHaveLength(1);
      expect(data.npcs[0].id).toBe("npc_a");
      expect(data.npcs[0].dialogueIds).toEqual(["talk"]);
      expect(data.dialogues).toHaveLength(1);
      expect(data.dialogues[0].id).toBe("talk");
      expect(data.dialogues[0].root).toBe("greeting");
      expect(data.triggers).toHaveLength(1);
    });
  });

  describe("dialogue builder", () => {
    it("auto-chains text nodes in source order", () => {
      const data = scenario("chain-test", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.text("first", t`One`);
          d.text("second", t`Two`);
          d.end("done");
        });
      });

      const nodes = data.dialogues[0].nodes;
      const first = nodes["first"];
      expect(first.type).toBe("text");
      if (first.type === "text") {
        expect(first.next).toBe("second");
      }
      const second = nodes["second"];
      if (second.type === "text") {
        expect(second.next).toBe("done");
      }
    });

    it("choice options with conditions", () => {
      const data = scenario("choice-test", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.choice("ch", [
            d.option("Option A").when(fact("x").gt(5)).goto("target_a"),
            d.option("Option B").goto("target_b"),
          ]);
          d.end("target_a");
          d.end("target_b");
        });
      });

      const choice = data.dialogues[0].nodes["ch"];
      expect(choice.type).toBe("choice");
      if (choice.type === "choice") {
        expect(choice.options).toHaveLength(2);
        expect(choice.options[0].condition).toBeDefined();
        expect(choice.options[1].condition).toBeUndefined();
      }
    });

    it("action node with effects and explicit next", () => {
      const data = scenario("action-test", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.action("act", [setFact("$npc", "done", true)], { next: "end_node" });
          d.end("end_node");
        });
      });

      const action = data.dialogues[0].nodes["act"];
      expect(action.type).toBe("action");
      if (action.type === "action") {
        expect(action.effects).toHaveLength(1);
        expect(action.next).toBe("end_node");
      }
    });

    it("d.trigger() registers on DialogueTreeData.triggers, not as a node", () => {
      const data = scenario("trigger-test", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.text("t1", t`Hello`);
          d.trigger(
            when(fact("x").eq(true)),
            [setFact("$npc", "y", true)],
            { targets: ["a", "$player"] },
          );
          d.text("t2", t`Goodbye`);
          d.end("done");
        });
      });

      const dialogue = data.dialogues[0];
      // trigger is not a node
      expect(dialogue.nodes["trigger"]).toBeUndefined();
      // trigger is in triggers array
      expect(dialogue.triggers).toHaveLength(1);
      // t1 auto-chains to t2 (trigger doesn't break chain)
      const t1 = dialogue.nodes["t1"];
      if (t1.type === "text") {
        expect(t1.next).toBe("t2");
      }
    });

    it("option labels can be TextTemplate", () => {
      const data = scenario("tpl-label", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.choice("ch", [
            d.option(t`I have ${player.prop("food")} food`).goto("end_node"),
          ]);
          d.end("end_node");
        });
      });

      const choice = data.dialogues[0].nodes["ch"];
      if (choice.type === "choice") {
        expect(Array.isArray(choice.options[0].label)).toBe(true);
        expect(choice.options[0].label.length).toBeGreaterThan(1);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/builders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement builders**

Create `shared/src/script-dsl/builders.ts`:

```typescript
import type {
  Value, Expr, Effect, AgentRef, TextTemplate,
  ScenarioData, NpcDefinition, DialogueTreeData, DialogueNodeData,
  ChoiceOptionData, TriggerRule, ResourceType,
} from "../script-types.js";
import { ExprBuilder, type ExprOrValue } from "./expressions.js";

// --- Helpers ---

function toExpr(v: ExprOrValue): Expr {
  if (v instanceof ExprBuilder) return v.toExpr();
  return { type: "literal", value: v };
}

// --- Simple effect builders ---

export function belief(key: string, value: Value): { key: string; value: Value } {
  return { key, value };
}

export function setFact(target: AgentRef, key: string, value: ExprOrValue): Effect {
  return { type: "set_fact", target, key, value: toExpr(value) };
}

export function give(target: AgentRef, item: ResourceType, amount: ExprOrValue): Effect {
  return { type: "give_item", target, item, amount: toExpr(amount) };
}

export function take(target: AgentRef, item: ResourceType, amount: ExprOrValue): Effect {
  return { type: "take_item", target, item, amount: toExpr(amount) };
}

export function damage(target: AgentRef, amount: ExprOrValue): Effect {
  return { type: "damage", target, amount: toExpr(amount) };
}

export function when(builder: ExprBuilder): Expr {
  return builder.toExpr();
}

// --- Option builder ---

export interface OptionBuilder {
  when(condition: ExprBuilder): OptionBuilder;
  goto(nodeId: string): OptionBuilder;
}

function createOptionBuilder(label: TextTemplate): { builder: OptionBuilder; getData: () => ChoiceOptionData } {
  const data: ChoiceOptionData = {
    id: "",
    label,
    next: "",
  };

  const builder: OptionBuilder = {
    when(condition: ExprBuilder) {
      data.condition = condition.toExpr();
      return builder;
    },
    goto(nodeId: string) {
      data.next = nodeId;
      return builder;
    },
  };

  return { builder, getData: () => data };
}

// --- Dialogue builder ---

interface DialogueBuilderApi {
  text(id: string, content: TextTemplate, opts?: { context?: string; next?: string; speaker?: string }): void;
  choice(id: string, options: OptionBuilder[]): void;
  action(id: string, effects: Effect[], opts: { next: string }): void;
  request(id: string, label: TextTemplate, opts: { nextYes: string; nextNo: string }): void;
  end(id: string): void;
  trigger(whenExpr: Expr, thenEffects: Effect[], opts: { targets: AgentRef[]; once?: boolean }): void;
  option(label: string | TextTemplate): OptionBuilder;
}

function createDialogueBuilder(
  dialogueId: string,
  scenarioId: string,
): { api: DialogueBuilderApi; build: () => DialogueTreeData } {
  const nodes: Record<string, DialogueNodeData> = {};
  const triggers: TriggerRule[] = [];
  const nodeOrder: string[] = [];
  const optionBuilders = new Map<OptionBuilder, () => ChoiceOptionData>();
  let triggerIndex = 0;

  // Auto-chaining: track which nodes need their "next" filled in
  const pendingAutoChain: string[] = [];

  function registerNode(id: string, node: DialogueNodeData): void {
    // Auto-chain: if there's a pending text node, point it to this node
    if (pendingAutoChain.length > 0) {
      const prevId = pendingAutoChain.pop()!;
      const prev = nodes[prevId];
      if (prev && prev.type === "text") {
        (prev as { next: string }).next = id;
      }
    }
    nodes[id] = node;
    nodeOrder.push(id);
  }

  const api: DialogueBuilderApi = {
    text(id, content, opts) {
      const speaker = opts?.speaker ?? "npc";
      registerNode(id, { type: "text", speaker, content, next: opts?.next ?? "" });
      // If explicit next was given, don't auto-chain. Otherwise mark as pending.
      if (!opts?.next) {
        pendingAutoChain.push(id);
      }
    },

    choice(id, options) {
      const optionData = options.map((ob, i) => {
        const getData = optionBuilders.get(ob);
        if (!getData) throw new Error(`Unknown option builder at index ${i}`);
        const data = getData();
        data.id = `${id}_opt_${i}`;
        return data;
      });
      registerNode(id, { type: "choice", options: optionData });
    },

    action(id, effects, opts) {
      registerNode(id, { type: "action", effects, next: opts.next });
    },

    request(id, label, opts) {
      registerNode(id, { type: "request", label, gateType: "llm", nextYes: opts.nextYes, nextNo: opts.nextNo });
    },

    end(id) {
      registerNode(id, { type: "end" });
    },

    trigger(whenExpr, thenEffects, opts) {
      triggers.push({
        id: `scenario:${scenarioId}:dialogue:${dialogueId}:${triggerIndex++}`,
        when: whenExpr,
        then: thenEffects,
        targets: opts.targets,
        once: opts.once ?? true,
        source: "scenario",
        fired: false,
      });
      // Note: d.trigger() does NOT call registerNode, so it doesn't affect auto-chain
    },

    option(label) {
      const tpl: TextTemplate = typeof label === "string" ? [label] : label;
      const { builder, getData } = createOptionBuilder(tpl);
      optionBuilders.set(builder, getData);
      return builder;
    },
  };

  function build(): DialogueTreeData {
    const root = nodeOrder.length > 0 ? nodeOrder[0] : "";
    return { id: dialogueId, root, nodes, triggers };
  }

  return { api, build };
}

// --- Scenario builder ---

interface ScenarioBuilderApi {
  npc(id: string, opts: {
    role: string;
    faction: string;
    position: { x: number; y: number };
    initialBeliefs: Array<{ key: string; value: Value }>;
  }): void;
  dialogue(npcId: string, dialogueId: string, fn: (d: DialogueBuilderApi) => void): void;
  trigger(whenExpr: Expr, thenEffects: Effect[], opts: { targets: AgentRef[]; once?: boolean }): void;
}

export function scenario(id: string, fn: (s: ScenarioBuilderApi) => void): ScenarioData {
  const npcs: NpcDefinition[] = [];
  const dialogues: DialogueTreeData[] = [];
  const triggers: TriggerRule[] = [];
  const npcDialogueMap = new Map<string, string[]>();
  let triggerIndex = 0;

  const api: ScenarioBuilderApi = {
    npc(npcId, opts) {
      npcDialogueMap.set(npcId, []);
      npcs.push({
        id: npcId,
        role: opts.role,
        faction: opts.faction,
        position: opts.position,
        initialBeliefs: opts.initialBeliefs,
        dialogueIds: npcDialogueMap.get(npcId)!,
      });
    },

    dialogue(npcId, dialogueId, builderFn) {
      const { api: dApi, build } = createDialogueBuilder(dialogueId, id);
      builderFn(dApi);
      dialogues.push(build());
      const ids = npcDialogueMap.get(npcId);
      if (ids) ids.push(dialogueId);
    },

    trigger(whenExpr, thenEffects, opts) {
      triggers.push({
        id: `scenario:${id}:${triggerIndex++}`,
        when: whenExpr,
        then: thenEffects,
        targets: opts.targets,
        once: opts.once ?? true,
        source: "scenario",
        fired: false,
      });
    },
  };

  fn(api);
  return { id, npcs, dialogues, triggers };
}
```

- [ ] **Step 4: Update index.ts to re-export builders**

Add to `shared/src/script-dsl/index.ts`:

```typescript
export {
  belief, setFact, give, take, damage, when, scenario,
} from "./builders.js";
export type { OptionBuilder } from "./builders.js";
```

- [ ] **Step 5: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/builders.test.ts`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add shared/src/script-dsl/builders.ts shared/src/script-dsl/index.ts server/test/script-dsl/builders.test.ts
git commit -m "feat(shared): add scenario and dialogue builders for eDSL"
```

---

### Task 5: Expression evaluator

**Files:**
- Create: `server/src/dialogue/evaluator.ts`
- Create: `server/test/dialogue/evaluator.test.ts`

- [ ] **Step 1: Write failing tests for evaluate()**

Create `server/test/dialogue/evaluator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluate, checkCondition, interpolate, normalizeTemplateKey } from "../../src/dialogue/evaluator.js";
import type { Expr, Fact, Value, TextTemplate } from "@town-zero/shared";

function makeCtx(overrides: {
  beliefs?: Record<string, Fact>;
  locals?: Record<string, Value>;
  playerInventory?: { food: number; material: number; currency: number };
  npcInventory?: { food: number; material: number; currency: number };
  npcHp?: number;
  tick?: number;
} = {}) {
  const beliefs = new Map(Object.entries(overrides.beliefs ?? {}));
  const locals = new Map(Object.entries(overrides.locals ?? {}));
  return {
    beliefs,
    locals,
    agentState: {
      player: {
        get(prop: string): Value {
          const inv = overrides.playerInventory ?? { food: 0, material: 0, currency: 0 };
          if (prop in inv) return (inv as Record<string, number>)[prop];
          return 0;
        },
      },
      npc: {
        get(prop: string): Value {
          if (prop === "hp") return overrides.npcHp ?? 100;
          const inv = overrides.npcInventory ?? { food: 0, material: 0, currency: 0 };
          if (prop in inv) return (inv as Record<string, number>)[prop];
          return 0;
        },
      },
      settlement: null,
    },
    currentTick: overrides.tick ?? 1,
  };
}

describe("evaluate()", () => {
  it("literal returns value", () => {
    expect(evaluate({ type: "literal", value: 42 }, makeCtx())).toBe(42);
  });

  it("fact_ref reads from beliefs", () => {
    const ctx = makeCtx({ beliefs: { x: { key: "x", value: "hello", tick: 1, source: "a" } } });
    expect(evaluate({ type: "fact_ref", key: "x" }, ctx)).toBe("hello");
  });

  it("fact_ref returns undefined-ish for missing key", () => {
    expect(evaluate({ type: "fact_ref", key: "missing" }, makeCtx())).toBeUndefined();
  });

  it("local_ref reads from locals", () => {
    const ctx = makeCtx({ locals: { cost: 5 } });
    expect(evaluate({ type: "local_ref", key: "cost" }, ctx)).toBe(5);
  });

  it("prop_ref reads from agent accessor", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 0, currency: 0 } });
    expect(evaluate({ type: "prop_ref", target: "player", prop: "food" }, ctx)).toBe(10);
  });

  it("compare eq", () => {
    expect(evaluate({
      type: "compare", op: "eq",
      left: { type: "literal", value: 5 },
      right: { type: "literal", value: 5 },
    }, makeCtx())).toBe(true);
  });

  it("compare neq", () => {
    expect(evaluate({
      type: "compare", op: "neq",
      left: { type: "literal", value: "a" },
      right: { type: "literal", value: "b" },
    }, makeCtx())).toBe(true);
  });

  it("compare gt", () => {
    expect(evaluate({
      type: "compare", op: "gt",
      left: { type: "literal", value: 10 },
      right: { type: "literal", value: 5 },
    }, makeCtx())).toBe(true);
  });

  it("arithmetic add", () => {
    expect(evaluate({
      type: "arithmetic", op: "add",
      left: { type: "literal", value: 3 },
      right: { type: "literal", value: 4 },
    }, makeCtx())).toBe(7);
  });

  it("logic and", () => {
    expect(evaluate({
      type: "logic", op: "and",
      args: [{ type: "literal", value: true }, { type: "literal", value: false }],
    }, makeCtx())).toBe(false);
  });

  it("logic or", () => {
    expect(evaluate({
      type: "logic", op: "or",
      args: [{ type: "literal", value: false }, { type: "literal", value: true }],
    }, makeCtx())).toBe(true);
  });

  it("logic not", () => {
    expect(evaluate({
      type: "logic", op: "not",
      args: [{ type: "literal", value: true }],
    }, makeCtx())).toBe(false);
  });

  it("call has_item", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 0, currency: 0 } });
    expect(evaluate({
      type: "call", fn: "has_item",
      args: [
        { type: "literal", value: "$player" },
        { type: "literal", value: "food" },
        { type: "literal", value: 5 },
      ],
    }, ctx)).toBe(true);
  });

  it("call count_item", () => {
    const ctx = makeCtx({ playerInventory: { food: 10, material: 3, currency: 0 } });
    expect(evaluate({
      type: "call", fn: "count_item",
      args: [
        { type: "literal", value: "$player" },
        { type: "literal", value: "material" },
      ],
    }, ctx)).toBe(3);
  });
});

describe("checkCondition()", () => {
  it("returns true for truthy value", () => {
    expect(checkCondition({ type: "literal", value: true }, makeCtx())).toBe(true);
    expect(checkCondition({ type: "literal", value: 1 }, makeCtx())).toBe(true);
  });

  it("returns false for falsy value", () => {
    expect(checkCondition({ type: "literal", value: false }, makeCtx())).toBe(false);
    expect(checkCondition({ type: "literal", value: 0 }, makeCtx())).toBe(false);
    expect(checkCondition({ type: "literal", value: "" }, makeCtx())).toBe(false);
  });
});

describe("interpolate()", () => {
  it("joins strings and evaluated expressions", () => {
    const tpl: TextTemplate = ["Hello ", { type: "fact_ref", key: "name" }, "!"];
    const ctx = makeCtx({ beliefs: { name: { key: "name", value: "Marcus", tick: 1, source: "a" } } });
    expect(interpolate(tpl, ctx)).toBe("Hello Marcus!");
  });

  it("plain string template", () => {
    expect(interpolate(["Hello world"], makeCtx())).toBe("Hello world");
  });
});

describe("normalizeTemplateKey()", () => {
  it("replaces Expr nodes with {0}, {1}", () => {
    const tpl: TextTemplate = ["Hello ", { type: "fact_ref", key: "name" }, " at ", { type: "literal", value: 5 }];
    expect(normalizeTemplateKey(tpl)).toBe("Hello {0} at {1}");
  });

  it("pure string returns as-is", () => {
    expect(normalizeTemplateKey(["Hello world"])).toBe("Hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/evaluator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the evaluator**

Create `server/src/dialogue/evaluator.ts`:

```typescript
import type { Expr, Value, TextTemplate, Fact } from "@town-zero/shared";

// --- Agent Accessor interface ---

export interface AgentAccessor {
  get(prop: string): Value;
}

export interface SettlementAccessor {
  get(prop: string): Value;
}

// --- Eval Context ---

export interface EvalContext {
  beliefs: ReadonlyMap<string, Fact>;
  locals: ReadonlyMap<string, Value>;
  agentState: {
    player: AgentAccessor;
    npc: AgentAccessor;
    settlement: SettlementAccessor | null;
  };
  currentTick: number;
}

// --- Function Registry ---

type BuiltinFn = (args: Value[], ctx: EvalContext) => Value;

const builtinFunctions: Record<string, BuiltinFn> = {
  has_item(args, ctx) {
    const [targetRef, item, amount] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    const count = accessor.get(String(item));
    return typeof count === "number" && typeof amount === "number" && count >= amount;
  },
  count_item(args, ctx) {
    const [targetRef, item] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    const count = accessor.get(String(item));
    return typeof count === "number" ? count : 0;
  },
  distance(args, ctx) {
    const [aRef, bRef] = args;
    const aAccessor = resolveAccessor(String(aRef), ctx);
    const bAccessor = resolveAccessor(String(bRef), ctx);
    const ax = aAccessor.get("x") as number;
    const ay = aAccessor.get("y") as number;
    const bx = bAccessor.get("x") as number;
    const by = bAccessor.get("y") as number;
    return Math.abs(ax - bx) + Math.abs(ay - by); // Manhattan distance
  },
  faction_of(args, ctx) {
    const [targetRef] = args;
    const accessor = resolveAccessor(String(targetRef), ctx);
    return accessor.get("faction");
  },
};

function resolveAccessor(ref: string, ctx: EvalContext): AgentAccessor {
  if (ref === "$player") return ctx.agentState.player;
  if (ref === "$npc") return ctx.agentState.npc;
  if (ref === "$settlement") {
    return ctx.agentState.settlement ?? { get: () => 0 };
  }
  // For concrete agent IDs, we'd need a broader lookup — for now, fall back to npc
  return ctx.agentState.npc;
}

// --- Evaluator ---

export function evaluate(expr: Expr, ctx: EvalContext): Value | undefined {
  switch (expr.type) {
    case "literal":
      return expr.value;

    case "fact_ref": {
      const fact = ctx.beliefs.get(expr.key);
      return fact?.value;
    }

    case "local_ref":
      return ctx.locals.get(expr.key);

    case "prop_ref": {
      if (expr.target === "settlement") {
        return ctx.agentState.settlement?.get(expr.prop) ?? 0;
      }
      return ctx.agentState[expr.target].get(expr.prop);
    }

    case "compare": {
      const left = evaluate(expr.left, ctx);
      const right = evaluate(expr.right, ctx);
      switch (expr.op) {
        case "eq": return left === right;
        case "neq": return left !== right;
        case "gt": return (left as number) > (right as number);
        case "lt": return (left as number) < (right as number);
        case "gte": return (left as number) >= (right as number);
        case "lte": return (left as number) <= (right as number);
      }
      break;
    }

    case "arithmetic": {
      const left = evaluate(expr.left, ctx) as number;
      const right = evaluate(expr.right, ctx) as number;
      switch (expr.op) {
        case "add": return left + right;
        case "sub": return left - right;
        case "mul": return left * right;
        case "div": return right !== 0 ? left / right : 0;
      }
      break;
    }

    case "logic": {
      switch (expr.op) {
        case "and": return expr.args.every((a) => !!evaluate(a, ctx));
        case "or": return expr.args.some((a) => !!evaluate(a, ctx));
        case "not": return !evaluate(expr.args[0], ctx);
      }
      break;
    }

    case "call": {
      const fn = builtinFunctions[expr.fn];
      if (!fn) throw new Error(`Unknown function: ${expr.fn}`);
      const args = expr.args.map((a) => evaluate(a, ctx) as Value);
      return fn(args, ctx);
    }
  }

  return undefined;
}

// --- Convenience ---

export function checkCondition(expr: Expr, ctx: EvalContext): boolean {
  return !!evaluate(expr, ctx);
}

export function interpolate(template: TextTemplate, ctx: EvalContext): string {
  return template
    .map((part) => (typeof part === "string" ? part : String(evaluate(part, ctx) ?? "")))
    .join("");
}

// --- i18n helpers ---

export function normalizeTemplateKey(template: TextTemplate): string {
  let index = 0;
  return template
    .map((part) => (typeof part === "string" ? part : `{${index++}}`))
    .join("");
}

export function resolveLocale(
  template: TextTemplate,
  locale: Record<string, string> | undefined,
  context?: string,
): TextTemplate {
  if (!locale) return template;
  let key = normalizeTemplateKey(template);
  if (context) key += `@@${context}`;
  const translated = locale[key];
  if (!translated) return template;

  // Parse translated string back to TextTemplate, re-inserting original Expr nodes
  const exprNodes = template.filter((p): p is Expr => typeof p !== "string");
  const result: TextTemplate = [];
  const parts = translated.split(/\{(\d+)\}/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i] !== "") result.push(parts[i]);
    } else {
      const idx = parseInt(parts[i], 10);
      if (idx < exprNodes.length) result.push(exprNodes[idx]);
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/evaluator.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/dialogue/evaluator.ts server/test/dialogue/evaluator.test.ts
git commit -m "feat(server): add expression evaluator with interpolation and i18n"
```

---

### Task 6: Effect executor

**Files:**
- Create: `server/src/dialogue/executor.ts`
- Create: `server/test/dialogue/executor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/test/dialogue/executor.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeEffects, type MutableContext } from "../../src/dialogue/executor.js";
import type { Effect, Fact, Value, TriggerRule } from "@town-zero/shared";

function makeMutableCtx(): {
  ctx: MutableContext;
  facts: Map<string, Map<string, Fact>>;
  localStore: Map<string, Value>;
  items: Map<string, Map<string, number>>;
  damages: Array<{ ref: string; amount: number }>;
  triggers: TriggerRule[];
} {
  const facts = new Map<string, Map<string, Fact>>();
  const localStore = new Map<string, Value>();
  const items = new Map<string, Map<string, number>>([
    ["$player", new Map([["food", 10], ["material", 5], ["currency", 0]])],
    ["$npc", new Map([["food", 3], ["material", 0], ["currency", 0]])],
  ]);
  const damages: Array<{ ref: string; amount: number }> = [];
  const triggers: TriggerRule[] = [];

  const ctx: MutableContext = {
    beliefs: new Map(),
    locals: localStore,
    agentState: {
      player: { get: (prop) => items.get("$player")?.get(prop) ?? 0 },
      npc: { get: (prop) => items.get("$npc")?.get(prop) ?? 0 },
      settlement: null,
    },
    currentTick: 10,
    npcId: "npc_a",
    setFact(ref, key, value) {
      if (!facts.has(ref)) facts.set(ref, new Map());
      facts.get(ref)!.set(key, { key, value, tick: 10, source: "npc_a" });
    },
    setLocal(key, value) {
      localStore.set(key, value);
    },
    giveItem(ref, item, amount) {
      const inv = items.get(ref);
      if (inv) inv.set(item, (inv.get(item) ?? 0) + amount);
    },
    takeItem(ref, item, amount) {
      const inv = items.get(ref);
      if (!inv) return false;
      const current = inv.get(item) ?? 0;
      if (current < amount) return false;
      inv.set(item, current - amount);
      return true;
    },
    damage(ref, amount) {
      damages.push({ ref, amount });
    },
    registerTrigger(rule) {
      triggers.push(rule);
    },
  };

  return { ctx, facts, localStore, items, damages, triggers };
}

describe("executeEffects()", () => {
  it("executes set_fact", () => {
    const { ctx, facts } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "set_fact", target: "$npc", key: "quest", value: { type: "literal", value: true } },
    ];
    executeEffects(effects, ctx);
    expect(facts.get("$npc")?.get("quest")?.value).toBe(true);
  });

  it("executes set_local", () => {
    const { ctx, localStore } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "set_local", key: "x", value: { type: "literal", value: 42 } },
    ];
    executeEffects(effects, ctx);
    expect(localStore.get("x")).toBe(42);
  });

  it("executes give_item", () => {
    const { ctx, items } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "give_item", target: "$player", item: "food", amount: { type: "literal", value: 3 } },
    ];
    executeEffects(effects, ctx);
    expect(items.get("$player")?.get("food")).toBe(13);
  });

  it("executes take_item", () => {
    const { ctx, items } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "take_item", target: "$player", item: "material", amount: { type: "literal", value: 3 } },
    ];
    executeEffects(effects, ctx);
    expect(items.get("$player")?.get("material")).toBe(2);
  });

  it("short-circuits on take_item failure", () => {
    const { ctx, facts } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "take_item", target: "$player", item: "material", amount: { type: "literal", value: 100 } },
      { type: "set_fact", target: "$npc", key: "should_not_run", value: { type: "literal", value: true } },
    ];
    executeEffects(effects, ctx);
    expect(facts.get("$npc")?.has("should_not_run")).toBeFalsy();
  });

  it("executes damage", () => {
    const { ctx, damages } = makeMutableCtx();
    const effects: Effect[] = [
      { type: "damage", target: "$player", amount: { type: "literal", value: 10 } },
    ];
    executeEffects(effects, ctx);
    expect(damages).toEqual([{ ref: "$player", amount: 10 }]);
  });

  it("executes register_trigger", () => {
    const { ctx, triggers } = makeMutableCtx();
    const rule: TriggerRule = {
      id: "rt:10:0",
      when: { type: "fact_ref", key: "x" },
      then: [],
      targets: ["$npc"],
      once: true,
      source: "runtime",
      fired: false,
    };
    const effects: Effect[] = [
      { type: "register_trigger", trigger: rule },
    ];
    executeEffects(effects, ctx);
    expect(triggers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/executor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the executor**

Create `server/src/dialogue/executor.ts`:

```typescript
import type { Effect, Value, TriggerRule } from "@town-zero/shared";
import { evaluate, type EvalContext } from "./evaluator.js";

export interface MutableContext extends EvalContext {
  npcId: string;
  setFact(ref: string, key: string, value: Value): void;
  setLocal(key: string, value: Value): void;
  giveItem(ref: string, item: string, amount: number): void;
  takeItem(ref: string, item: string, amount: number): boolean;
  damage(ref: string, amount: number): void;
  registerTrigger(rule: TriggerRule): void;
}

type EffectHandler = (effect: Effect, ctx: MutableContext) => boolean; // false = short-circuit

const effectHandlers: Record<string, EffectHandler> = {
  set_fact(effect, ctx) {
    if (effect.type !== "set_fact") return true;
    const value = evaluate(effect.value, ctx) as Value;
    ctx.setFact(effect.target, effect.key, value);
    return true;
  },

  set_local(effect, ctx) {
    if (effect.type !== "set_local") return true;
    const value = evaluate(effect.value, ctx) as Value;
    ctx.setLocal(effect.key, value);
    return true;
  },

  give_item(effect, ctx) {
    if (effect.type !== "give_item") return true;
    const amount = evaluate(effect.amount, ctx) as number;
    ctx.giveItem(effect.target, effect.item, amount);
    return true;
  },

  take_item(effect, ctx) {
    if (effect.type !== "take_item") return true;
    const amount = evaluate(effect.amount, ctx) as number;
    return ctx.takeItem(effect.target, effect.item, amount);
  },

  damage(effect, ctx) {
    if (effect.type !== "damage") return true;
    const amount = evaluate(effect.amount, ctx) as number;
    ctx.damage(effect.target, amount);
    return true;
  },

  register_trigger(effect, ctx) {
    if (effect.type !== "register_trigger") return true;
    ctx.registerTrigger(effect.trigger);
    return true;
  },
};

export function executeEffects(effects: Effect[], ctx: MutableContext): void {
  for (const effect of effects) {
    const handler = effectHandlers[effect.type];
    if (!handler) throw new Error(`Unknown effect type: ${effect.type}`);
    const continueExecution = handler(effect, ctx);
    if (!continueExecution) break; // short-circuit on failure (e.g., take_item insufficient)
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/executor.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/dialogue/executor.ts server/test/dialogue/executor.test.ts
git commit -m "feat(server): add effect executor with short-circuit on take_item failure"
```

---

### Task 7: Agent beliefs and dialogue progress

**Files:**
- Modify: `server/src/simulation/agent.ts`
- Create: `server/test/simulation/beliefs.test.ts`

- [ ] **Step 1: Write failing tests for Agent belief methods**

Create `server/test/simulation/beliefs.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import type { Fact } from "@town-zero/shared";

function makeAgent(id = "a"): Agent {
  return new Agent({ id, position: { x: 0, y: 0 }, faction: "v1", role: "scout", controller: "bot" });
}

describe("Agent beliefs", () => {
  it("starts with empty beliefs", () => {
    const agent = makeAgent();
    expect(agent.getAllBeliefs().size).toBe(0);
  });

  it("set and get a belief", () => {
    const agent = makeAgent();
    agent.setBelief("bridge_status", { key: "bridge_status", value: "destroyed", tick: 5, source: "a" });
    const fact = agent.getBelief("bridge_status");
    expect(fact?.value).toBe("destroyed");
  });

  it("mergeBeliefs keeps newer tick", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    a.setBelief("x", { key: "x", value: "old", tick: 1, source: "a" });
    b.setBelief("x", { key: "x", value: "new", tick: 5, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("x")?.value).toBe("new");
    expect(a.getBelief("x")?.tick).toBe(5);
  });

  it("mergeBeliefs does not overwrite newer with older", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    a.setBelief("x", { key: "x", value: "newer", tick: 10, source: "a" });
    b.setBelief("x", { key: "x", value: "older", tick: 1, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("x")?.value).toBe("newer");
  });

  it("mergeBeliefs adds beliefs target doesn't have", () => {
    const a = makeAgent("a");
    const b = makeAgent("b");

    b.setBelief("y", { key: "y", value: true, tick: 3, source: "b" });

    a.mergeBeliefs(b.getAllBeliefs());
    expect(a.getBelief("y")?.value).toBe(true);
  });
});

describe("Agent dialogueProgress", () => {
  it("starts with empty progress", () => {
    const agent = makeAgent();
    expect(agent.getDialogueProgress("tree1")).toBeUndefined();
  });

  it("set and get progress", () => {
    const agent = makeAgent();
    agent.setDialogueProgress("tree1", {
      visitedNodes: ["greeting", "main"],
      selectedOptions: { main: "opt_0" },
      locals: { cost: 5 },
    });
    const progress = agent.getDialogueProgress("tree1");
    expect(progress?.visitedNodes).toContain("greeting");
    expect(progress?.locals.cost).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/simulation/beliefs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add beliefs and dialogueProgress to Agent**

Modify `server/src/simulation/agent.ts`. Add these imports at the top:

```typescript
import type { Fact, DialogueProgressEntry } from "@town-zero/shared";
```

Add to the `Agent` class (after the `mapMemory` field):

```typescript
  private beliefs: Map<string, Fact> = new Map();
  private dialogueProgress: Map<string, DialogueProgressEntry> = new Map();

  // --- Beliefs ---

  setBelief(key: string, fact: Fact): void {
    this.beliefs.set(key, fact);
  }

  getBelief(key: string): Fact | undefined {
    return this.beliefs.get(key);
  }

  getAllBeliefs(): Map<string, Fact> {
    return this.beliefs;
  }

  mergeBeliefs(other: Map<string, Fact>): void {
    for (const [key, fact] of other) {
      const existing = this.beliefs.get(key);
      if (!existing || fact.tick > existing.tick) {
        this.beliefs.set(key, { ...fact });
      }
    }
  }

  // --- Dialogue Progress ---

  getDialogueProgress(treeId: string): DialogueProgressEntry | undefined {
    return this.dialogueProgress.get(treeId);
  }

  setDialogueProgress(treeId: string, entry: DialogueProgressEntry): void {
    this.dialogueProgress.set(treeId, entry);
  }
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/simulation/beliefs.test.ts`
Expected: All pass.

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/beliefs.test.ts
git commit -m "feat(server): add beliefs and dialogueProgress to Agent"
```

---

### Task 8: Belief merge in vision.ts + tick Phase 8

**Files:**
- Modify: `server/src/simulation/vision.ts`
- Modify: `server/src/simulation/tick.ts`
- Create: `server/src/dialogue/trigger-registry.ts`
- Create: `server/test/dialogue/trigger-registry.test.ts`

- [ ] **Step 1: Write failing tests for TriggerRegistry**

Create `server/test/dialogue/trigger-registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TriggerRegistry } from "../../src/dialogue/trigger-registry.js";
import type { TriggerRule, Fact, Value } from "@town-zero/shared";

function makeRule(overrides: Partial<TriggerRule> = {}): TriggerRule {
  return {
    id: "test:0",
    when: { type: "compare", op: "eq", left: { type: "fact_ref", key: "x" }, right: { type: "literal", value: true } },
    then: [{ type: "set_fact", target: "$npc", key: "y", value: { type: "literal", value: true } }],
    targets: ["npc_a"],
    once: false,
    source: "scenario",
    fired: false,
    ...overrides,
  };
}

describe("TriggerRegistry", () => {
  it("registers and retrieves triggers", () => {
    const reg = new TriggerRegistry();
    const rule = makeRule();
    reg.register(rule);
    expect(reg.getAll()).toHaveLength(1);
  });

  it("recordChangedFact tracks keys", () => {
    const reg = new TriggerRegistry();
    reg.recordChangedFact("x");
    reg.recordChangedFact("y");
    expect(reg.getChangedFacts()).toContain("x");
    expect(reg.getChangedFacts()).toContain("y");
  });

  it("evaluateBatch fires matching triggers", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("x");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe("test:0");
  });

  it("does not fire when condition is false", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("x");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: false, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(0);
  });

  it("does not fire if no relevant fact changed", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule());
    reg.recordChangedFact("unrelated_key");

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);
    const fired = reg.evaluateBatch(beliefs, 1);
    expect(fired).toHaveLength(0);
  });

  it("once: true trigger fires only once", () => {
    const reg = new TriggerRegistry();
    reg.register(makeRule({ once: true }));

    const beliefs = new Map<string, Fact>([
      ["x", { key: "x", value: true, tick: 1, source: "a" }],
    ]);

    reg.recordChangedFact("x");
    const fired1 = reg.evaluateBatch(beliefs, 1);
    expect(fired1).toHaveLength(1);

    reg.recordChangedFact("x");
    const fired2 = reg.evaluateBatch(beliefs, 2);
    expect(fired2).toHaveLength(0);
  });

  it("clearChangedFacts resets for next tick", () => {
    const reg = new TriggerRegistry();
    reg.recordChangedFact("x");
    reg.clearChangedFacts();
    expect(reg.getChangedFacts().size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/trigger-registry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement TriggerRegistry**

Create `server/src/dialogue/trigger-registry.ts`:

```typescript
import type { Expr, Fact, TriggerRule, Effect } from "@town-zero/shared";
import { checkCondition, type EvalContext } from "./evaluator.js";

export interface FiredTrigger {
  rule: TriggerRule;
  targets: string[];
}

/** Extract all fact_ref keys referenced in an expression (for change-tracking). */
function extractFactKeys(expr: Expr): Set<string> {
  const keys = new Set<string>();
  function walk(e: Expr): void {
    if (e.type === "fact_ref") {
      keys.add(e.key);
    } else if (e.type === "compare" || e.type === "arithmetic") {
      walk(e.left);
      walk(e.right);
    } else if (e.type === "logic") {
      for (const arg of e.args) walk(arg);
    } else if (e.type === "call") {
      for (const arg of e.args) walk(arg);
    }
  }
  walk(expr);
  return keys;
}

export class TriggerRegistry {
  private rules: TriggerRule[] = [];
  private changedFacts: Set<string> = new Set();
  // Pre-computed: which fact keys each rule depends on
  private ruleFactKeys: Map<string, Set<string>> = new Map();

  register(rule: TriggerRule): void {
    this.rules.push(rule);
    this.ruleFactKeys.set(rule.id, extractFactKeys(rule.when));
  }

  getAll(): TriggerRule[] {
    return this.rules;
  }

  recordChangedFact(key: string): void {
    this.changedFacts.add(key);
  }

  getChangedFacts(): Set<string> {
    return this.changedFacts;
  }

  clearChangedFacts(): void {
    this.changedFacts.clear();
  }

  /** Evaluate all triggers whose `when` references any changed fact. Returns fired triggers. */
  evaluateBatch(beliefs: ReadonlyMap<string, Fact>, currentTick: number): FiredTrigger[] {
    const fired: FiredTrigger[] = [];

    for (const rule of this.rules) {
      if (rule.once && rule.fired) continue;

      // Check if any changed fact is relevant to this rule's condition
      const deps = this.ruleFactKeys.get(rule.id);
      if (!deps) continue;
      let relevant = false;
      for (const key of this.changedFacts) {
        if (deps.has(key)) { relevant = true; break; }
      }
      if (!relevant) continue;

      // Evaluate condition
      const ctx: EvalContext = {
        beliefs,
        locals: new Map(),
        agentState: {
          player: { get: () => 0 },
          npc: { get: () => 0 },
          settlement: null,
        },
        currentTick,
      };

      if (checkCondition(rule.when, ctx)) {
        if (rule.once) rule.fired = true;
        fired.push({ rule, targets: [...rule.targets] });
      }
    }

    return fired;
  }
}
```

- [ ] **Step 4: Run trigger registry tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/trigger-registry.test.ts`
Expected: All pass.

- [ ] **Step 5: Extend mergeAdjacentMemories in vision.ts**

Modify `server/src/simulation/vision.ts`. In the `mergeAdjacentMemories` function, add belief merge after the existing memory merge calls:

```typescript
      a.mergeMemory(b.getAllMemory());
      b.mergeMemory(a.getAllMemory());
      // Belief merge
      a.mergeBeliefs(b.getAllBeliefs());
      b.mergeBeliefs(a.getAllBeliefs());
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All tests pass including existing vision/merge tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/dialogue/trigger-registry.ts server/test/dialogue/trigger-registry.test.ts server/src/simulation/vision.ts
git commit -m "feat(server): add TriggerRegistry and extend belief merge in vision"
```

Note: Phase 8 (trigger evaluation in processTick) is wired in Task 10 after the scenario loader is ready, since it needs the full runtime context.

---

### Task 9: Refactor DialogueEngine to use evaluator/executor

**Files:**
- Modify: `server/src/dialogue/dialogue-engine.ts`
- Modify: `server/test/dialogue/dialogue-engine.test.ts`

- [ ] **Step 1: Update DialogueEngine tests to use new AST-based nodes**

Rewrite `server/test/dialogue/dialogue-engine.test.ts` to test:
- Text node content is interpolated via evaluator
- Choice options are filtered by condition evaluation
- Action nodes execute effects via executor
- DialogueProgress is updated as nodes are visited

The test tree should use the new `DialogueTreeData` types with `TextTemplate`, `Expr` conditions, and `Effect[]` instead of string fields.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/dialogue-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Refactor DialogueEngine**

Refactor `server/src/dialogue/dialogue-engine.ts`:
- Constructor takes `DialogueTreeData` instead of `DialogueTree`
- `advance()` on action nodes calls `executeEffects()`
- `getVisibleOptions()` method filters choice options by evaluating conditions
- `getInterpolatedContent()` method returns interpolated text for current text node
- Engine holds a reference to `EvalContext` (passed at construction or per-method)
- Track visited nodes in `DialogueProgressEntry`

- [ ] **Step 4: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/dialogue/dialogue-engine.test.ts`
Expected: All pass.

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/dialogue/dialogue-engine.ts server/test/dialogue/dialogue-engine.test.ts
git commit -m "refactor(server): DialogueEngine uses evaluator/executor for AST-based nodes"
```

---

### Task 10: Scenario loader and tick integration

**Files:**
- Create: `server/src/simulation/scenario-loader.ts`
- Create: `server/test/simulation/scenario-loader.test.ts`
- Modify: `server/src/simulation/tick.ts`

- [ ] **Step 1: Write failing tests for scenario loader**

Create `server/test/simulation/scenario-loader.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadScenario } from "../../src/simulation/scenario-loader.js";
import { scenario, belief, setFact, when, fact, t } from "@town-zero/shared/script-dsl";
import type { SimulationState } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";

function makeState(): SimulationState {
  return {
    grid: new Grid(20, 20),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0,
  };
}

describe("loadScenario()", () => {
  it("spawns NPCs with initial beliefs", () => {
    const data = scenario("test", (s) => {
      s.npc("elder", {
        role: "merchant",
        faction: "v1",
        position: { x: 5, y: 5 },
        initialBeliefs: [belief("is_elder", true)],
      });
      s.dialogue("elder", "talk", (d) => {
        d.text("hi", t`Hello`);
        d.end("done");
      });
    });

    const state = makeState();
    const result = loadScenario(data, state);

    expect(state.agents.has("elder")).toBe(true);
    const agent = state.agents.get("elder")!;
    expect(agent.faction).toBe("v1");
    expect(agent.getBelief("is_elder")?.value).toBe(true);
    expect(result.triggerRegistry.getAll().length).toBe(0);
  });

  it("registers scenario-level triggers", () => {
    const data = scenario("test", (s) => {
      s.npc("a", { role: "scout", faction: "v1", position: { x: 0, y: 0 }, initialBeliefs: [] });
      s.dialogue("a", "d", (d) => {
        d.text("hi", t`Hello`);
        d.end("done");
      });
      s.trigger(when(fact("x").eq(true)), [setFact("a", "y", true)], { targets: ["a"] });
    });

    const state = makeState();
    const result = loadScenario(data, state);
    expect(result.triggerRegistry.getAll()).toHaveLength(1);
  });

  it("registers dialogue-scoped triggers", () => {
    const data = scenario("test", (s) => {
      s.npc("a", { role: "scout", faction: "v1", position: { x: 0, y: 0 }, initialBeliefs: [] });
      s.dialogue("a", "d", (d) => {
        d.text("hi", t`Hello`);
        d.trigger(when(fact("x").eq(true)), [setFact("$npc", "y", true)], { targets: ["a"] });
        d.end("done");
      });
    });

    const state = makeState();
    const result = loadScenario(data, state);
    expect(result.triggerRegistry.getAll()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/simulation/scenario-loader.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement scenario loader**

Create `server/src/simulation/scenario-loader.ts`:

```typescript
import type { ScenarioData, DialogueTreeData } from "@town-zero/shared";
import { Agent } from "./agent.js";
import { TriggerRegistry } from "../dialogue/trigger-registry.js";
import type { SimulationState } from "./tick.js";

export interface ScenarioLoadResult {
  triggerRegistry: TriggerRegistry;
  dialogueTrees: Map<string, DialogueTreeData>;
}

export function loadScenario(data: ScenarioData, state: SimulationState): ScenarioLoadResult {
  const triggerRegistry = new TriggerRegistry();
  const dialogueTrees = new Map<string, DialogueTreeData>();

  // Spawn NPCs
  for (const npcDef of data.npcs) {
    const agent = new Agent({
      id: npcDef.id,
      position: npcDef.position,
      faction: npcDef.faction,
      role: npcDef.role,
      controller: "bot",
    });

    // Inject initial beliefs
    for (const { key, value } of npcDef.initialBeliefs) {
      agent.setBelief(key, { key, value, tick: state.tick, source: npcDef.id });
    }

    state.agents.set(npcDef.id, agent);
  }

  // Register dialogue trees
  for (const tree of data.dialogues) {
    dialogueTrees.set(tree.id, tree);

    // Register dialogue-scoped triggers
    for (const trigger of tree.triggers) {
      triggerRegistry.register(trigger);
    }
  }

  // Register scenario-level triggers
  for (const trigger of data.triggers) {
    triggerRegistry.register(trigger);
  }

  return { triggerRegistry, dialogueTrees };
}
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/simulation/scenario-loader.test.ts`
Expected: All pass.

- [ ] **Step 5: Add Phase 8 to processTick**

Modify `server/src/simulation/tick.ts`. The `processTick` function signature needs access to the trigger registry. Update `SimulationState` to include an optional trigger registry:

Add to `SimulationState` interface:

```typescript
import { TriggerRegistry } from "../dialogue/trigger-registry.js";

export interface SimulationState {
  // ... existing fields ...
  triggerRegistry?: TriggerRegistry;
}
```

At the end of `processTick`, after Phase 7 (memory merge), add Phase 8:

```typescript
  // Phase 8: Trigger evaluation (deferred-batch)
  if (state.triggerRegistry) {
    // Collect all beliefs across all agents for a union view (triggers are global)
    const allBeliefs = new Map<string, Fact>();
    for (const [, agent] of agents) {
      if (!agent.isAlive()) continue;
      for (const [key, fact] of agent.getAllBeliefs()) {
        const existing = allBeliefs.get(key);
        if (!existing || fact.tick > existing.tick) {
          allBeliefs.set(key, fact);
        }
      }
    }

    const fired = state.triggerRegistry.evaluateBatch(allBeliefs, tick);

    for (const { rule, targets } of fired) {
      for (const targetRef of targets) {
        // Resolve target agents
        let targetAgents: Agent[] = [];
        if (targetRef.startsWith("$faction:")) {
          const faction = targetRef.slice("$faction:".length);
          targetAgents = Array.from(agents.values()).filter(
            (a) => a.isAlive() && a.faction === faction,
          );
        } else {
          const agent = agents.get(targetRef);
          if (agent?.isAlive()) targetAgents = [agent];
        }

        // Execute effects on each target
        for (const targetAgent of targetAgents) {
          for (const effect of rule.then) {
            if (effect.type === "set_fact") {
              const value = evaluate(effect.value, {
                beliefs: targetAgent.getAllBeliefs(),
                locals: new Map(),
                agentState: {
                  player: { get: () => 0 },
                  npc: { get: (p) => targetAgent.inventory[p as keyof ResourceStore] ?? 0 },
                  settlement: null,
                },
                currentTick: tick,
              }) as Value;
              targetAgent.setBelief(effect.key, {
                key: effect.key,
                value,
                tick,
                source: "trigger:" + rule.id,
              });
            }
            // Other effect types (give_item, damage, etc.) can be added as needed
          }
        }
      }
    }

    state.triggerRegistry.clearChangedFacts();
  }
```

Add the necessary imports at the top of `tick.ts`:

```typescript
import type { Fact, Value, ResourceStore } from "@town-zero/shared";
import { evaluate } from "../dialogue/evaluator.js";
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/simulation/scenario-loader.ts server/test/simulation/scenario-loader.test.ts server/src/simulation/tick.ts
git commit -m "feat(server): add scenario loader and Phase 8 trigger hook in tick"
```

---

### Task 11: LLM prompt integration

**Files:**
- Modify: `server/src/ai/prompt-builder.ts`
- Modify: `server/test/ai/prompt-builder.test.ts` (if exists, otherwise create)

- [ ] **Step 1: Write failing test for beliefs in prompt**

Add a test that calls `buildPrompt` with an agent that has beliefs and verifies the output contains a beliefs section.

```typescript
it("includes beliefs section when agent has beliefs", () => {
  const agent = makeAgent();
  agent.setBelief("bridge_status", { key: "bridge_status", value: "destroyed", tick: 42, source: "scout" });
  agent.setBelief("rep", { key: "rep", value: 7, tick: 38, source: agent.id });

  const prompt = buildPrompt(agent, { food: 0, material: 0, currency: 0 }, 50);
  expect(prompt).toContain("bridge_status");
  expect(prompt).toContain("destroyed");
  expect(prompt).toContain("scout");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run the prompt-builder test.
Expected: FAIL — prompt doesn't contain beliefs.

- [ ] **Step 3: Add beliefs serialization to buildPrompt**

In `server/src/ai/prompt-builder.ts`, after the existing memory/vision section, add:

```typescript
  // Beliefs section
  const beliefs = agent.getAllBeliefs();
  if (beliefs.size > 0) {
    lines.push("");
    lines.push("What you know (beliefs):");
    for (const [key, fact] of beliefs) {
      const ticksAgo = currentTick - fact.tick;
      const sourceNote = fact.source === agent.id ? "your own observation" : `from ${fact.source}`;
      lines.push(`- ${key}: ${fact.value} (${ticksAgo} ticks ago, ${sourceNote})`);
    }
  }
```

- [ ] **Step 4: Run tests**

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/prompt-builder.ts server/test/ai/prompt-builder.test.ts
git commit -m "feat(server): add beliefs section to LLM prompt"
```

---

### Task 11.5: Dialogue gate TextTemplate interpolation

**Files:**
- Modify: `server/src/dialogue/dialogue-gate.ts`
- Modify: `server/test/dialogue/dialogue-gate.test.ts` (if exists, otherwise create)

- [ ] **Step 1: Write failing test**

Write a test that calls `evaluateDialogueGate` with a `TextTemplate` label (instead of plain string) and verifies it interpolates correctly before sending to the LLM.

The current signature takes `requestLabel: string`. Change it to accept `TextTemplate` and an `EvalContext`, interpolate the template to a string, then use that string in the prompt.

```typescript
import { describe, it, expect } from "vitest";
import { evaluateDialogueGate } from "../../src/dialogue/dialogue-gate.js";
import type { TextTemplate, Fact } from "@town-zero/shared";

describe("evaluateDialogueGate with TextTemplate", () => {
  it("interpolates TextTemplate label in the prompt", async () => {
    let capturedPrompt = "";
    const mockLLM = async (prompt: string) => {
      capturedPrompt = prompt;
      return "y";
    };

    const label: TextTemplate = ["Trade ", { type: "fact_ref", key: "item_name" }, " for food"];
    const beliefs = new Map<string, Fact>([
      ["item_name", { key: "item_name", value: "木材", tick: 1, source: "a" }],
    ]);

    // Updated signature: pass TextTemplate + beliefs
    await evaluateDialogueGate(
      /* npc */ makeTestAgent(),
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(capturedPrompt).toContain("Trade 木材 for food");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — signature mismatch.

- [ ] **Step 3: Update evaluateDialogueGate**

Modify `server/src/dialogue/dialogue-gate.ts`:
- Change `requestLabel: string` parameter to `requestLabel: TextTemplate`
- Add `beliefs: ReadonlyMap<string, Fact>` parameter
- Import and call `interpolate()` from `evaluator.ts` to convert `TextTemplate` to string
- Include beliefs in the prompt (reuse the same format as `prompt-builder.ts`)

- [ ] **Step 4: Run tests**

Expected: All pass.

- [ ] **Step 5: Update any callers of evaluateDialogueGate**

Search for calls to `evaluateDialogueGate` and update them to pass `TextTemplate` + beliefs.

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/dialogue/dialogue-gate.ts server/test/dialogue/dialogue-gate.test.ts
git commit -m "feat(server): dialogue gate interpolates TextTemplate labels"
```

---

### Task 12: Serialization round-trip tests

**Files:**
- Create: `server/test/script-dsl/serialization.test.ts`

- [ ] **Step 1: Write serialization tests**

Create `server/test/script-dsl/serialization.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  scenario, belief, setFact, give, take, when, fact, local, player, t,
} from "@town-zero/shared/script-dsl";
import type { Fact, DialogueProgressEntry, TriggerRule } from "@town-zero/shared";

describe("JSON serialization round-trip", () => {
  it("ScenarioData survives JSON round-trip", () => {
    const data = scenario("test", (s) => {
      s.npc("a", {
        role: "merchant",
        faction: "v1",
        position: { x: 1, y: 2 },
        initialBeliefs: [belief("flag", true), belief("count", 42)],
      });
      s.dialogue("a", "talk", (d) => {
        d.text("greeting", t`Hello ${fact("name")}!`);
        d.choice("ch", [
          d.option("Option A").when(fact("x").gt(5)).goto("end_node"),
          d.option(t`Option B with ${player.prop("food")}`).goto("end_node"),
        ]);
        d.action("act", [
          take("$player", "material", local("cost")),
          setFact("$npc", "done", true),
        ], { next: "end_node" });
        d.trigger(
          when(fact("done").eq(true)),
          [setFact("$npc", "reward_given", true)],
          { targets: ["a", "$player"] },
        );
        d.end("end_node");
      });
      s.trigger(
        when(fact("global_flag").eq(true)),
        [give("a", "food", 10)],
        { targets: ["a"] },
      );
    });

    const json = JSON.stringify(data);
    const restored = JSON.parse(json);
    expect(restored).toEqual(data);
  });

  it("Fact survives JSON round-trip", () => {
    const fact: Fact = { key: "bridge", value: "destroyed", tick: 42, source: "scout_a" };
    expect(JSON.parse(JSON.stringify(fact))).toEqual(fact);
  });

  it("DialogueProgressEntry survives JSON round-trip", () => {
    const entry: DialogueProgressEntry = {
      visitedNodes: ["greeting", "main"],
      selectedOptions: { main: "opt_0" },
      locals: { cost: 5, name: "Marcus" },
    };
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });

  it("TriggerRule with runtime source survives round-trip", () => {
    const rule: TriggerRule = {
      id: "rt:42:0",
      when: { type: "compare", op: "eq", left: { type: "fact_ref", key: "x" }, right: { type: "literal", value: true } },
      then: [{ type: "set_fact", target: "$npc", key: "y", value: { type: "literal", value: true } }],
      targets: ["a", "$player"],
      once: true,
      source: "runtime",
      fired: false,
    };
    expect(JSON.parse(JSON.stringify(rule))).toEqual(rule);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/script-dsl/serialization.test.ts`
Expected: All pass (these should pass immediately since all types are plain JSON).

- [ ] **Step 3: Commit**

```bash
git add server/test/script-dsl/serialization.test.ts
git commit -m "test: add JSON serialization round-trip tests for all script types"
```

---

### Task 13: Integration test — bridge-crisis scenario

**Files:**
- Create: `server/test/integration-dialogue.test.ts`

- [ ] **Step 1: Write integration test**

Create `server/test/integration-dialogue.test.ts` that tests the full flow:

1. Define a bridge-crisis scenario using the eDSL
2. Load it into a SimulationState
3. Verify NPCs are spawned with initial beliefs
4. Simulate belief propagation (two adjacent agents merge beliefs)
5. Start a dialogue, verify conditions filter options, execute effects
6. Verify trigger fires after fact change

This test exercises the entire pipeline: eDSL → ScenarioData → load → Agent beliefs → evaluator → executor → trigger.

```typescript
import { describe, it, expect } from "vitest";
import { scenario, belief, setFact, take, when, fact, local, player, t } from "@town-zero/shared/script-dsl";
import { loadScenario } from "../src/simulation/scenario-loader.js";
import { Grid } from "../src/simulation/grid.js";
import type { SimulationState } from "../src/simulation/tick.js";

describe("Bridge crisis integration", () => {
  function setup() {
    const data = scenario("bridge-crisis", (s) => {
      s.npc("elder", {
        role: "merchant", faction: "v1", position: { x: 5, y: 5 },
        initialBeliefs: [belief("bridge_status", "intact"), belief("is_elder", true)],
      });
      s.npc("scout", {
        role: "scout", faction: "v1", position: { x: 6, y: 5 },
        initialBeliefs: [belief("patrol_route", "north")],
      });

      s.dialogue("elder", "elder-talk", (d) => {
        d.text("greeting", t`Welcome, traveler.`);
        d.choice("main", [
          d.option("Ask about bridge")
            .when(fact("bridge_status").neq("intact"))
            .goto("bridge-info"),
          d.option("Goodbye").goto("farewell"),
        ]);
        d.text("bridge-info", t`The bridge is ${fact("bridge_status")}.`);
        d.text("farewell", t`Safe travels.`);
        d.end("done");
      });

      s.trigger(
        when(fact("bridge_status").eq("destroyed")),
        [setFact("elder", "bridge_crisis", true)],
        { targets: ["elder", "scout"] },
      );
    });

    const state: SimulationState = {
      grid: new Grid(20, 20),
      agents: new Map(),
      settlements: new Map(),
      tick: 0,
      nextMerchantId: 0,
    };

    const result = loadScenario(data, state);
    return { data, state, ...result };
  }

  it("spawns NPCs with beliefs", () => {
    const { state } = setup();
    expect(state.agents.has("elder")).toBe(true);
    expect(state.agents.get("elder")!.getBelief("bridge_status")?.value).toBe("intact");
    expect(state.agents.get("elder")!.getBelief("is_elder")?.value).toBe(true);
  });

  it("adjacent same-faction agents merge beliefs", () => {
    const { state } = setup();
    const elder = state.agents.get("elder")!;
    const scout = state.agents.get("scout")!;

    // Elder knows bridge status, scout doesn't
    expect(scout.getBelief("bridge_status")).toBeUndefined();

    // Merge (they are adjacent: (5,5) and (6,5))
    elder.mergeBeliefs(scout.getAllBeliefs());
    scout.mergeBeliefs(elder.getAllBeliefs());

    // Now scout knows bridge status
    expect(scout.getBelief("bridge_status")?.value).toBe("intact");
    // Elder learned patrol_route from scout
    expect(elder.getBelief("patrol_route")?.value).toBe("north");
  });

  it("trigger registry detects changed facts", () => {
    const { triggerRegistry } = setup();
    expect(triggerRegistry.getAll()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm --filter @town-zero/server exec vitest run test/integration-dialogue.test.ts`
Expected: All pass.

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/test/integration-dialogue.test.ts
git commit -m "test: add bridge-crisis integration test for dialogue script system"
```

---

### Task 14: Migrate villager-basic.json to eDSL and clean up

**Files:**
- Create: `server/src/dialogue/trees/villager-basic.ts` (eDSL version)
- Delete: `server/src/dialogue/trees/villager-basic.json`

- [ ] **Step 1: Write the villager-basic scenario in eDSL**

Create `server/src/dialogue/trees/villager-basic.ts`:

```typescript
import { scenario, belief, t } from "@town-zero/shared/script-dsl";

export const villagerBasicScenario = scenario("villager-basic", (s) => {
  // NPC definition is separate — this just defines the dialogue tree.
  // The scenario is loaded by the game room, which binds NPCs to settlements.
  s.npc("villager", {
    role: "farmer",
    faction: "village",
    position: { x: 0, y: 0 },
    initialBeliefs: [],
  });

  s.dialogue("villager", "villager-basic", (d) => {
    d.text("greeting", t`Hello, what can I do for you?`);

    d.choice("main-choices", [
      d.option("How is the village doing?").goto("village-status"),
      d.option("Can you scout the north?").goto("scout-request"),
      d.option("Can you gather food?").goto("gather-request"),
      d.option("Never mind.").goto("farewell"),
    ]);

    d.text("village-status", t`We're managing, but food supplies are getting low.`,
      { next: "main-choices" }); // explicit next: loop back to choices

    d.request("scout-request", t`Scout the northern area`, {
      nextYes: "scout-yes",
      nextNo: "scout-no",
    });
    d.text("scout-yes", t`Alright, I'll head north and report back.`,
      { next: "farewell" });
    d.text("scout-no", t`I can't right now, I have other duties.`,
      { next: "main-choices" });

    d.request("gather-request", t`Go gather food for the village`, {
      nextYes: "gather-yes",
      nextNo: "gather-no",
    });
    d.text("gather-yes", t`Sure, I'll head to the fields.`,
      { next: "farewell" });
    d.text("gather-no", t`I need to rest first, maybe later.`,
      { next: "main-choices" });

    d.text("farewell", t`Take care out there.`);
    d.end("done");
  });
});
```

Note: Looping dialogue nodes use explicit `{ next: "target" }` to override auto-chain. The `text()` builder supports this via the `opts.next` parameter added in Task 4.

- [ ] **Step 2: Delete the old JSON file**

```bash
rm server/src/dialogue/trees/villager-basic.json
```

- [ ] **Step 3: Update any imports that reference the JSON file**

Search for references to `villager-basic.json` and update them.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/dialogue/trees/villager-basic.ts
git rm server/src/dialogue/trees/villager-basic.json
git commit -m "refactor: migrate villager-basic from JSON to eDSL scenario"
```

---

### Task 15: Server-side dialogue session management

**Files:**
- Create: `server/src/dialogue/dialogue-session.ts`
- Create: `server/test/dialogue/dialogue-session.test.ts`
- Modify: `server/src/rooms/GameRoom.ts`

This task wires the dialogue system into GameRoom so clients can initiate and advance dialogues. No client UI is implemented — only server-side message handling.

- [ ] **Step 1: Write failing tests for DialogueSession**

Create `server/test/dialogue/dialogue-session.test.ts`:

Test that `DialogueSession`:
- Builds `DialogueStateMessage` from current engine node (text interpolated, options filtered)
- Advances on `dialogue:advance` (text nodes)
- Selects on `dialogue:select` (choice nodes)
- Returns `type: "end"` when dialogue ends
- Executes effects on action nodes during advance
- Persists `DialogueProgressEntry` on NPC when session ends

```typescript
interface DialogueStateMessage {
  treeId: string;
  nodeId: string;
  type: "text" | "choice" | "request_pending" | "end";
  speaker: string;
  text: string;
  options?: Array<{ id: string; label: string }>;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Implement DialogueSession**

Create `server/src/dialogue/dialogue-session.ts`:

- `DialogueSession` wraps a `DialogueEngine` + `EvalContext` + `MutableContext`
- `getState(): DialogueStateMessage` — interpolates current node, filters options
- `advance(): DialogueStateMessage` — text node → next
- `select(optionId: string): DialogueStateMessage` — choice node → execute → next
- `cancel(): void` — cleanup
- `isEnded(): boolean`

- [ ] **Step 4: Run tests**

Expected: All pass.

- [ ] **Step 5: Wire into GameRoom**

Modify `server/src/rooms/GameRoom.ts`:
- Add `dialogueSessions: Map<string, DialogueSession>` field
- Add `onMessage("dialogue:advance")`, `onMessage("dialogue:select")`, `onMessage("dialogue:cancel")` handlers
- Update `talk` command handling to create a session and send initial `dialogue:state`
- On `onLeave`, clean up any active session
- Validate: NPC is adjacent, alive, not already in dialogue with another player

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/caasi/GitHub/caasi/town-zero && pnpm run test`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/dialogue/dialogue-session.ts server/test/dialogue/dialogue-session.test.ts server/src/rooms/GameRoom.ts
git commit -m "feat(server): add dialogue session management and GameRoom wiring"
```

---

## Summary

| Task | Component | New Tests | Est. Steps |
|------|-----------|-----------|------------|
| 1 | AST types + migration | Build check | 7 |
| 2 | ExprBuilder + primitives | 10 tests | 6 |
| 3 | Tagged template `t` | 5 tests | 6 |
| 4 | Scenario/dialogue builders | 8 tests | 6 |
| 5 | Expression evaluator | 16 tests | 5 |
| 6 | Effect executor | 7 tests | 5 |
| 7 | Agent beliefs | 7 tests | 6 |
| 8 | Trigger registry + merge | 6 tests | 7 |
| 9 | DialogueEngine refactor | Update existing | 6 |
| 10 | Scenario loader + tick | 3 tests | 7 |
| 11 | LLM prompt beliefs | 1 test | 5 |
| 11.5 | Dialogue gate TextTemplate | 1 test | 7 |
| 12 | Serialization round-trip | 4 tests | 3 |
| 13 | Integration test | 3 tests | 4 |
| 14 | Migrate villager-basic | — | 5 |
| 15 | Dialogue session + GameRoom | 5 tests | 7 |
| **Total** | | **~76 tests** | **~92 steps** |
