# Unified InputFrame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual-channel input model (`moveQueue` + `plan`) with a single `InputFrame` queue, making all actions instant (1 tick) and eliminating multi-tick FSM states.

**Architecture:** One `InputFrame { seq, direction?, action? }` is consumed per agent per tick. `planBacklog` holds LLM/bot multi-step strategies and auto-shifts into the input queue. `FrameAction` replaces `ActionCommand`; `commands.ts` is deleted. FSM reduces to `idle`/`dead`.

**Tech Stack:** TypeScript (strict), pnpm workspaces (`shared/`, `server/`, `client/`), Vitest, Colyseus 0.17.x + @colyseus/schema 4.x

**Spec:** `docs/superpowers/specs/2026-04-05-unified-input-frame-design.md`

---

### Task 1: Add `InputFrame` and `FrameAction` types to shared

**Files:**
- Modify: `shared/src/types.ts`
- Modify: `shared/src/constants.ts`

- [ ] **Step 1: Add `FrameAction` and `InputFrame` types**

In `shared/src/types.ts`, add after the `PendingInput` interface:

```typescript
export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "talk"; targetId: string }
  | { type: "idle" };

export interface InputFrame {
  seq: number;
  direction?: Facing;
  action?: FrameAction;
}
```

- [ ] **Step 2: Rename `MOVE_QUEUE_CAP` to `INPUT_QUEUE_CAP`**

In `shared/src/constants.ts`, rename:

```typescript
export const INPUT_QUEUE_CAP = 3;       // server-side per-agent input buffer depth
```

Keep `PENDING_INPUT_CAP` and `DIRECTION_DELTA` unchanged. Remove `MOVE_QUEUE_CAP`.

**Note:** Do NOT change `FSMState` yet — it will be reduced to `idle`/`dead` in Task 9 after all consumers are updated. This avoids a multi-task broken-build window.

- [ ] **Step 3: Build shared package**

Run: `pnpm run build`
Expected: Shared builds successfully. Downstream packages may have errors from `MOVE_QUEUE_CAP` rename — those are fixed in their respective tasks.

- [ ] **Step 4: Commit**

```bash
git add shared/src/types.ts shared/src/constants.ts
git commit -m "feat(shared): add InputFrame/FrameAction types, rename MOVE_QUEUE_CAP to INPUT_QUEUE_CAP"
```

---

### Task 2: Rewrite `Agent` class for InputFrame model

**Files:**
- Modify: `server/src/simulation/agent.ts`
- Modify: `server/test/simulation/agent.test.ts`

- [ ] **Step 1: Write failing tests for new agent API**

In `server/test/simulation/agent.test.ts`, replace the `moveQueue` describe block and the plan-related tests:

```typescript
describe("inputQueue", () => {
  it("initialises with empty inputQueue, planBacklog, and lastProcessedInput 0", () => {
    const agent = makeAgent();
    expect(agent.inputQueue).toEqual([]);
    expect(agent.planBacklog).toEqual([]);
    expect(agent.lastProcessedInput).toBe(0);
  });

  it("caps inputQueue at INPUT_QUEUE_CAP, dropping oldest", () => {
    const agent = makeAgent();
    agent.enqueueInput({ seq: 1, direction: "north" });
    agent.enqueueInput({ seq: 2, direction: "east" });
    agent.enqueueInput({ seq: 3, direction: "south" });
    agent.enqueueInput({ seq: 4, direction: "west" }); // overflow
    expect(agent.inputQueue).toHaveLength(3);
    expect(agent.inputQueue[0].seq).toBe(2); // oldest (seq=1) dropped
  });

  it("player frame (seq > 0) flushes seq=0 frames and clears planBacklog", () => {
    const agent = makeAgent();
    agent.planBacklog = [{ seq: 0, action: { type: "idle" } }];
    agent.inputQueue.push({ seq: 0, action: { type: "idle" } });
    agent.enqueueInput({ seq: 1, direction: "south" });
    expect(agent.inputQueue).toEqual([{ seq: 1, direction: "south" }]);
    expect(agent.planBacklog).toEqual([]);
  });
});
```

Also update the "creates agent with default values" test to check `inputQueue` instead of `plan`:

```typescript
expect(agent.inputQueue).toEqual([]);
expect(agent.planBacklog).toEqual([]);
```

Remove tests for `setPlan`, `clearPlan`, `shiftPlan` (those methods are being deleted).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `inputQueue`, `planBacklog`, `enqueueInput` don't exist yet.

- [ ] **Step 3: Implement Agent changes**

In `server/src/simulation/agent.ts`:

1. Replace imports: `PendingInput` → `InputFrame`, `ActionCommand` → `FrameAction`, `MOVE_QUEUE_CAP` → `INPUT_QUEUE_CAP`
2. Replace fields:

```typescript
// Replace these fields:
//   plan: ActionCommand[];
//   moveQueue: PendingInput[] = [];
//   currentCommandTicks: number = 0;
//   currentCommandTarget: number = 0;
//   currentTargetId: string | null = null;
//   gatherTile: Position | null = null;
// With:
inputQueue: InputFrame[] = [];
lastProcessedInput: number = 0;
planBacklog: InputFrame[] = [];
```

3. Replace methods `setPlan`, `clearPlan`, `shiftPlan`, `enqueueMoveInput` with:

```typescript
enqueueInput(frame: InputFrame): void {
  // Player frame (seq > 0) flushes bot frames and planBacklog
  if (frame.seq > 0) {
    this.inputQueue = this.inputQueue.filter((f) => f.seq > 0);
    this.planBacklog = [];
  }
  this.inputQueue.push(frame);
  while (this.inputQueue.length > INPUT_QUEUE_CAP) {
    this.inputQueue.shift();
  }
}
```

4. Update `takeDamage` to clear `inputQueue` instead of `plan`:

```typescript
takeDamage(damage: number): void {
  this.hp = Math.max(0, this.hp - damage);
  if (this.hp <= 0) {
    this.state = "dead";
    this.inputQueue = [];
    this.planBacklog = [];
  }
}
```

5. Remove `state: "idle"` from constructor (FSMState still starts as "idle" — keep that line). Remove the initialisation of deleted fields.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test`
Expected: Agent tests pass. Other tests will fail (they reference old API). That's expected.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/agent.ts server/test/simulation/agent.test.ts
git commit -m "feat(server): rewrite Agent for InputFrame model — inputQueue, planBacklog, enqueueInput"
```

---

### Task 3: Create `executeFrame` replacing `commands.ts`

**Files:**
- Create: `server/src/simulation/execute-frame.ts`
- Create: `server/test/simulation/execute-frame.test.ts`
- The old `server/src/simulation/commands.ts` will be deleted in a later task after all references are updated.

- [ ] **Step 1: Write failing tests for executeFrame**

Create `server/test/simulation/execute-frame.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { executeFrame, type FrameContext } from "../../src/simulation/execute-frame.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { BASE_ATTACK_DAMAGE } from "@town-zero/shared";
import type { InputFrame } from "@town-zero/shared";

function makeCtx(): FrameContext {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  grid.setResourceYield(4, 4, "material");
  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "player" });
  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addResource("food", 10);
  const agents = new Map([["a1", agent]]);
  const settlements = new Map([["v1", settlement]]);
  const activeSessions = new Map();
  return { grid, agent, agents, settlements, activeSessions };
}

describe("executeFrame", () => {
  describe("direction only", () => {
    it("turn-before-move: changes facing when direction differs", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, direction: "east" };
      executeFrame(frame, ctx);
      expect(ctx.agent.facing).toBe("east");
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // didn't move
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("moves when already facing that direction", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, direction: "south" }; // default facing
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 6 });
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("rejects move onto impassable terrain", () => {
      const ctx = makeCtx();
      ctx.grid.setTerrain(5, 4, "water");
      ctx.agent.facing = "north";
      const frame: InputFrame = { seq: 1, direction: "north" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 });
      expect(ctx.agent.lastProcessedInput).toBe(1); // seq still advances
    });
  });

  describe("gather action", () => {
    it("instantly yields 1 resource when adjacent to resource tile", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 3, y: 2 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(1);
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("yields material from material tile", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 4, y: 3 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 4, y: 4 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.material).toBe(1);
    });

    it("rejects gather when not adjacent", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 0, y: 0 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(0);
    });

    it("rejects gather on tile without resource", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 5, y: 5 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 5, y: 6 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(0);
    });
  });

  describe("attack action", () => {
    it("instantly deals BASE_ATTACK_DAMAGE to adjacent target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
    });

    it("rejects attack on non-adjacent target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 8, y: 8 }, faction: "den-1", role: "beast", controller: "bot" });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(100);
    });

    it("rejects attack on dead target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot", hp: 0 });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(0);
    });
  });

  describe("deposit action", () => {
    it("transfers all agent inventory to settlement", () => {
      const ctx = makeCtx();
      ctx.agent.addToInventory("material", 5);
      const frame: InputFrame = { seq: 1, action: { type: "deposit", settlementId: "v1" } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.material).toBe(0);
      expect(ctx.settlements.get("v1")!.inventory.material).toBe(5);
    });

    it("rejects deposit when not in territory", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 0, y: 0 };
      ctx.agent.addToInventory("food", 5);
      const frame: InputFrame = { seq: 1, action: { type: "deposit", settlementId: "v1" } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(5); // not deposited
    });
  });

  describe("take action", () => {
    it("transfers resource from settlement to agent", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, action: { type: "take", settlementId: "v1", resource: "food", amount: 3 } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(3);
      expect(ctx.settlements.get("v1")!.inventory.food).toBe(7);
    });
  });

  describe("trade action", () => {
    it("exchanges resources between agents", () => {
      const ctx = makeCtx();
      ctx.agent.addToInventory("food", 5);
      const target = new Agent({ id: "merchant", position: { x: 5, y: 6 }, faction: "merchant", role: "merchant", controller: "bot" });
      target.addToInventory("currency", 5);
      ctx.agents.set("merchant", target);
      const frame: InputFrame = { seq: 1, action: { type: "trade", targetId: "merchant", offer: "food", offerAmount: 2, want: "currency", wantAmount: 1 } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(3);
      expect(ctx.agent.inventory.currency).toBe(1);
      expect(target.inventory.food).toBe(2);
      expect(target.inventory.currency).toBe(4);
    });
  });

  describe("action priority over direction", () => {
    it("ignores direction when action is present", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 3, y: 2 };
      ctx.agent.facing = "south";
      const frame: InputFrame = { seq: 1, direction: "east", action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(1);
      expect(ctx.agent.facing).toBe("south"); // facing unchanged — direction ignored
      expect(ctx.agent.position).toEqual({ x: 3, y: 2 }); // position unchanged
    });
  });

  describe("seq handling", () => {
    it("updates lastProcessedInput for seq > 0", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 5, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(5);
    });

    it("does NOT update lastProcessedInput for seq = 0 (planBacklog frame)", () => {
      const ctx = makeCtx();
      ctx.agent.lastProcessedInput = 3;
      const frame: InputFrame = { seq: 0, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(3);
    });
  });

  describe("dialogue lock", () => {
    it("rejects all frames when agent is in dialogue", () => {
      const ctx = makeCtx();
      // Simulate active dialogue session for this agent
      ctx.activeSessions.set("npc-1", { playerId: "a1" } as any);
      ctx.agent.talkingToNpcId = "npc-1";
      const frame: InputFrame = { seq: 1, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // didn't move
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- server/test/simulation/execute-frame.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement executeFrame**

Create `server/src/simulation/execute-frame.ts`:

```typescript
import { TERRAIN_MOVE_COST, DIRECTION_DELTA, BASE_ATTACK_DAMAGE } from "@town-zero/shared";
import type { InputFrame, ResourceType } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import type { DialogueSession } from "../dialogue/dialogue-session.js";
import { startDialogue } from "../dialogue/session-manager.js";
import type { SimulationState } from "./tick.js";

export interface TalkResult {
  agentId: string;
  targetId: string;
  result: import("../dialogue/session-manager.js").DialogueResult;
}

export interface FrameContext {
  grid: Grid;
  agent: Agent;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  activeSessions: Map<string, DialogueSession>;
  simState: SimulationState;             // needed for startDialogue
  talkResults: TalkResult[];             // collects talk outcomes for GameRoom to send messages
}

function isValidAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}

const VALID_RESOURCE_TYPES = new Set(["food", "material", "currency"]);

export function executeFrame(frame: InputFrame, ctx: FrameContext): void {
  const { grid, agent, agents, settlements, activeSessions } = ctx;

  // Dialogue lock: reject all input while in dialogue
  if (agent.talkingToNpcId) {
    for (const [, session] of activeSessions) {
      if (session.playerId === agent.id) {
        if (frame.seq > 0) agent.lastProcessedInput = frame.seq;
        return;
      }
    }
  }

  if (frame.action) {
    executeAction(frame.action, ctx);
  } else if (frame.direction) {
    executeDirection(frame.direction, agent, grid);
  }

  if (frame.seq > 0) {
    agent.lastProcessedInput = frame.seq;
  }
}

function executeDirection(direction: string, agent: Agent, grid: Grid): void {
  const delta = DIRECTION_DELTA[direction];
  if (!delta) return;

  const target = { x: agent.position.x + delta.dx, y: agent.position.y + delta.dy };

  // Turn-before-move
  if (direction !== agent.facing) {
    agent.facing = direction as any;
    return;
  }

  // Terrain check
  const terrain = grid.getTerrain(target.x, target.y);
  if (!terrain) return;
  if (TERRAIN_MOVE_COST[terrain] === Infinity) return;
  if (!grid.inBounds(target.x, target.y)) return;

  agent.position = target;
}

function executeAction(action: InputFrame["action"], ctx: FrameContext): void {
  if (!action) return;
  const { grid, agent, agents, settlements } = ctx;

  switch (action.type) {
    case "gather": {
      const resource = grid.getResourceYield(action.resourceTile.x, action.resourceTile.y);
      if (!resource) return;
      if (!grid.isAdjacent(agent.position, action.resourceTile)) return;
      agent.addToInventory(resource, 1);
      break;
    }
    case "attack": {
      const target = agents.get(action.targetId);
      if (!target || !target.isAlive()) return;
      if (!grid.isAdjacent(agent.position, target.position)) return;
      target.takeDamage(BASE_ATTACK_DAMAGE);
      break;
    }
    case "deposit": {
      const settlement = settlements.get(action.settlementId);
      if (!settlement) return;
      if (!settlement.isInTerritory(agent.position)) return;
      for (const res of ["food", "material", "currency"] as ResourceType[]) {
        const amount = agent.inventory[res];
        if (amount > 0) {
          agent.removeFromInventory(res, amount);
          settlement.addResource(res, amount);
        }
      }
      break;
    }
    case "take": {
      if (!isValidAmount(action.amount)) return;
      if (!VALID_RESOURCE_TYPES.has(action.resource)) return;
      const settlement = settlements.get(action.settlementId);
      if (!settlement) return;
      if (!settlement.isInTerritory(agent.position)) return;
      if (settlement.inventory[action.resource as ResourceType] < action.amount) return;
      if (settlement.removeResource(action.resource as ResourceType, action.amount)) {
        agent.addToInventory(action.resource as ResourceType, action.amount);
      }
      break;
    }
    case "trade": {
      if (!isValidAmount(action.offerAmount) || !isValidAmount(action.wantAmount)) return;
      if (!VALID_RESOURCE_TYPES.has(action.offer) || !VALID_RESOURCE_TYPES.has(action.want)) return;
      const target = agents.get(action.targetId);
      if (!target || !target.isAlive()) return;
      if (!grid.isAdjacent(agent.position, target.position)) return;
      if (!agent.hasResource(action.offer as ResourceType, action.offerAmount)) return;
      if (!target.hasResource(action.want as ResourceType, action.wantAmount)) return;
      const offerOk = agent.removeFromInventory(action.offer as ResourceType, action.offerAmount);
      const wantOk = target.removeFromInventory(action.want as ResourceType, action.wantAmount);
      if (offerOk) target.addToInventory(action.offer as ResourceType, action.offerAmount);
      if (wantOk) agent.addToInventory(action.want as ResourceType, action.wantAmount);
      if (offerOk && !wantOk) {
        agent.addToInventory(action.offer as ResourceType, action.offerAmount);
        target.removeFromInventory(action.offer as ResourceType, action.offerAmount);
      }
      if (!offerOk && wantOk) {
        target.addToInventory(action.want as ResourceType, action.wantAmount);
        agent.removeFromInventory(action.want as ResourceType, action.wantAmount);
      }
      break;
    }
    case "talk": {
      // Initiate dialogue inline — spec requires executeFrame to call startDialogue
      const talkTarget = agents.get(action.targetId);
      if (!talkTarget || !talkTarget.isAlive()) return;
      if (!grid.isAdjacent(agent.position, talkTarget.position)) return;
      const result = startDialogue(agent.id, action.targetId, ctx.simState);
      ctx.talkResults.push({ agentId: agent.id, targetId: action.targetId, result });
      break;
    }
    case "idle":
      break;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- server/test/simulation/execute-frame.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/execute-frame.ts server/test/simulation/execute-frame.test.ts
git commit -m "feat(server): add executeFrame — unified action/direction processing in single tick"
```

---

### Task 4: Rewrite `processTick` for InputFrame consumption

**Files:**
- Modify: `server/src/simulation/tick.ts`
- Modify: `server/test/simulation/tick.test.ts`

- [ ] **Step 1: Write new tick tests replacing old ones**

Rewrite `server/test/simulation/tick.test.ts`. The key changes:
- Remove all multi-tick gather/combat tests
- Replace `moveQueue` tests with `inputQueue` tests
- Add `planBacklog` consumption tests
- Add instant gather/attack tests via InputFrame

```typescript
import { describe, it, expect } from "vitest";
import type { SimulationState } from "../../src/simulation/tick.js";
import { processTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { FOOD_CONSUMPTION_INTERVAL, BASE_ATTACK_DAMAGE } from "@town-zero/shared";

function makeWorld(): SimulationState {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  grid.setOwner(5, 5, "v1");
  grid.setOwner(5, 6, "v1");

  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addStructure({ id: "h1", type: "housing", position: { x: 5, y: 5 }, operatorId: null });

  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
  agent.addToInventory("food", 10);
  settlement.populationIds.push("a1");

  return {
    grid,
    agents: new Map([["a1", agent]]),
    settlements: new Map([["v1", settlement]]),
    tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("processTick", () => {
  it("increments tick counter", () => {
    const world = makeWorld();
    processTick(world);
    expect(world.tick).toBe(1);
  });

  describe("Phase 1: InputFrame consumption", () => {
    it("consumes one InputFrame per tick from inputQueue", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "south" });
      agent.enqueueInput({ seq: 2, direction: "south" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 6 });
      expect(agent.lastProcessedInput).toBe(1);
      expect(agent.inputQueue).toHaveLength(1);
    });

    it("falls back to planBacklog when inputQueue is empty", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.planBacklog = [{ seq: 0, action: { type: "idle" } }];
      processTick(world);
      expect(agent.planBacklog).toHaveLength(0);
      expect(agent.lastProcessedInput).toBe(0); // seq=0 doesn't update
    });

    it("instant gather via InputFrame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.position = { x: 3, y: 2 };
      agent.enqueueInput({ seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } });
      processTick(world);
      expect(agent.inventory.food).toBe(11); // 10 initial + 1 gathered
      expect(agent.state).toBe("idle"); // no FSM change
    });

    it("instant attack via InputFrame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
      target.addToInventory("food", 10);
      world.agents.set("enemy", target);
      agent.enqueueInput({ seq: 1, action: { type: "attack", targetId: "enemy" } });
      processTick(world);
      expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
      expect(agent.state).toBe("idle");
    });

    it("action takes priority over direction in same frame", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.position = { x: 3, y: 2 };
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "east", action: { type: "gather", resourceTile: { x: 3, y: 3 } } });
      processTick(world);
      expect(agent.inventory.food).toBe(11);
      expect(agent.facing).toBe("south"); // direction ignored
    });

    it("skips dead agents", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.hp = 0;
      agent.state = "dead";
      agent.inputQueue.push({ seq: 1, direction: "south" });
      processTick(world);
      expect(agent.position).toEqual({ x: 5, y: 5 }); // didn't move
    });

    it("turn-before-move via InputFrame direction", () => {
      const world = makeWorld();
      const agent = world.agents.get("a1")!;
      agent.facing = "south";
      agent.enqueueInput({ seq: 1, direction: "east" });
      processTick(world);
      expect(agent.facing).toBe("east");
      expect(agent.position).toEqual({ x: 5, y: 5 }); // turned only
      expect(agent.lastProcessedInput).toBe(1);
    });
  });

  it("processes food consumption and starvation", () => {
    const world = makeWorld();
    const agent = world.agents.get("a1")!;
    agent.inventory.food = 0;
    for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL; i++) {
      processTick(world);
    }
    expect(agent.hp).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- server/test/simulation/tick.test.ts`
Expected: FAIL — `processTick` still uses old model.

- [ ] **Step 3: Rewrite processTick**

In `server/src/simulation/tick.ts`:

1. Remove imports: `GATHER_DURATION`, `ATTACK_COOLDOWN_TICKS`, `validateCommand`, `executeCommand`, `processGathering`, `processCombat`
2. Add import: `executeFrame` from `./execute-frame.js`
3. Change `processTick` return type from `void` to `TalkResult[]`. Replace Phase 1 + Phase 1.5 + Phase 2 with unified Phase 1:

```typescript
import { executeFrame, type TalkResult } from "./execute-frame.js";

export function processTick(state: SimulationState): TalkResult[] {
  state.tick++;
  const { grid, agents, settlements, tick } = state;
  const talkResults: TalkResult[] = [];

  // Phase 1: Consume one InputFrame per alive agent
  for (const [, agent] of agents) {
    if (!agent.isAlive()) continue;

    let frame: InputFrame | undefined;

    if (agent.inputQueue.length > 0) {
      frame = agent.inputQueue.shift()!;
    } else if (agent.planBacklog.length > 0) {
      frame = agent.planBacklog.shift()!;
    }

    if (frame) {
      const ctx = { grid, agent, agents, settlements, activeSessions: state.activeSessions, simState: state, talkResults };
      executeFrame(frame, ctx);
    }
  }

  // ... rest of phases unchanged ...
  return talkResults;
}
```

4. Remove the old Phase 1 (gathering), Phase 1.5 (moveQueue), and Phase 2 (plan dequeue) code blocks entirely.
5. Add `InputFrame` to the import from `@town-zero/shared`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run test -- server/test/simulation/tick.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/simulation/tick.ts server/test/simulation/tick.test.ts
git commit -m "feat(server): rewrite processTick for InputFrame consumption — all actions instant"
```

---

### Task 5: Update bot controller for `FrameAction`

**Files:**
- Modify: `server/src/ai/bot-controller.ts`
- Modify: `server/test/ai/bot-controller.test.ts`
- Modify: `server/src/simulation/tick.ts` (Phase 2 bot integration)

- [ ] **Step 1: Write updated bot controller tests**

In `server/test/ai/bot-controller.test.ts`, change the return type expectations from `ActionCommand` to `InputFrame[]`:

```typescript
import { describe, it, expect } from "vitest";
import { decideBotAction } from "../../src/ai/bot-controller.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";

describe("decideBotAction", () => {
  it("returns direction toward settlement when food is low", () => {
    const agent = new Agent({ id: "a1", position: { x: 7, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const frames = decideBotAction(agent, settlement);
    expect(frames[0].seq).toBe(0);
    expect(frames[0].direction).toBe("west"); // moving toward x=5
  });

  it("returns idle when already in settlement territory with food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    agent.addToInventory("food", 5);
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const frames = decideBotAction(agent, settlement);
    expect(frames[0].action?.type).toBe("idle");
  });

  it("returns take when in settlement with no personal food but settlement has food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    settlement.addResource("food", 10);
    const frames = decideBotAction(agent, settlement);
    expect(frames[0].action?.type).toBe("take");
  });
});
```

Note: bot movement now uses `InputFrame.direction` directly (e.g., `{ seq: 0, direction: "west" }`), so bots retain the ability to walk toward targets.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- server/test/ai/bot-controller.test.ts`
Expected: FAIL — `decideBotAction` still returns single `ActionCommand`.

- [ ] **Step 3: Implement bot controller changes**

In `server/src/ai/bot-controller.ts`:

```typescript
import type { InputFrame, ResourceType, Facing } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";

function directionToward(from: { x: number; y: number }, to: { x: number; y: number }): Facing | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx > 0) return "east";
  if (dx < 0) return "west";
  if (dy > 0) return "south";
  if (dy < 0) return "north";
  return null;
}

export function decideBotAction(agent: Agent, settlement: Settlement): InputFrame[] {
  const inTerritory = settlement.isInTerritory(agent.position);

  if (agent.inventory.food <= 0) {
    if (inTerritory && settlement.inventory.food > 0) {
      return [{ seq: 0, action: { type: "take", settlementId: settlement.id, resource: "food" as ResourceType, amount: Math.min(3, settlement.inventory.food) } }];
    }
    const dir = directionToward(agent.position, settlement.territory[0]);
    if (dir) return [{ seq: 0, direction: dir }];
  }

  if (inTerritory && agent.inventory.food > 0) {
    return [{ seq: 0, action: { type: "idle" } }];
  }

  const dir = directionToward(agent.position, settlement.territory[0]);
  if (dir) return [{ seq: 0, direction: dir }];

  return [{ seq: 0, action: { type: "idle" } }];
}
```

- [ ] **Step 4: Update tick.ts Phase 2 to write planBacklog**

In `server/src/simulation/tick.ts`, update the bot controller phase:

```typescript
// Phase 2: Bot controller for idle bot agents
for (const [, agent] of agents) {
  if (!agent.isAlive() || agent.controller !== "bot") continue;
  if (agent.inputQueue.length > 0 || agent.planBacklog.length > 0) continue;
  if (agent.role === "merchant") continue;

  const settlement = Array.from(settlements.values()).find((s) =>
    s.populationIds.includes(agent.id),
  );
  if (settlement) {
    const frames = decideBotAction(agent, settlement);
    agent.planBacklog = frames;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm run test -- server/test/ai/bot-controller.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/bot-controller.ts server/test/ai/bot-controller.test.ts server/src/simulation/tick.ts
git commit -m "feat(server): update bot controller to return FrameAction[] for planBacklog"
```

---

### Task 6: Update LLM response parser and scheduler for `FrameAction` / `InputFrame`

**Files:**
- Modify: `server/src/ai/response-parser.ts`
- Modify: `server/test/ai/response-parser.test.ts`
- Modify: `server/src/ai/llm-scheduler.ts`
- Modify: `server/test/ai/llm-scheduler.test.ts`

- [ ] **Step 1: Update response parser**

In `server/src/ai/response-parser.ts`, change `ActionCommand` references to `FrameAction`:

```typescript
import type { FrameAction } from "@town-zero/shared";

const VALID_TYPES = new Set(["gather", "attack", "deposit", "take", "talk", "trade", "idle"]);
// Remove "move" from valid types
```

Update the return type of `parseResponse` to `FrameAction[]` and update `isValidCommand` to exclude `move`.

- [ ] **Step 2: Update response parser tests**

In `server/test/ai/response-parser.test.ts`, update imports from `ActionCommand` to `FrameAction` and remove any tests for `move` commands in LLM output.

- [ ] **Step 3: Update LLM scheduler**

In `server/src/ai/llm-scheduler.ts`:

1. Change the busy check from `agent.state !== "idle" || agent.plan.length > 0` to `agent.inputQueue.length > 0 || agent.planBacklog.length > 0`
2. Change `agent.setPlan(commands)` to `agent.planBacklog = commands.map(a => ({ seq: 0, action: a }))` — wraps each `FrameAction` from parseResponse into an `InputFrame` with `seq: 0`

- [ ] **Step 4: Update LLM scheduler tests**

In `server/test/ai/llm-scheduler.test.ts`:

1. Replace `agent.state = "gathering"` with `agent.inputQueue.push({ seq: 0, action: { type: "idle" } })` (to simulate busy agent)
2. Replace `agent.plan = [...]` with `agent.planBacklog = [...]`
3. Replace assertions checking `agent.plan` with `agent.planBacklog`

- [ ] **Step 5: Run tests**

Run: `pnpm run test -- server/test/ai/response-parser.test.ts server/test/ai/llm-scheduler.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/response-parser.ts server/test/ai/response-parser.test.ts server/src/ai/llm-scheduler.ts server/test/ai/llm-scheduler.test.ts
git commit -m "feat(server): update LLM response parser and scheduler for FrameAction/InputFrame"
```

---

### Task 7: Update GameRoom message handlers

**Files:**
- Modify: `server/src/rooms/GameRoom.ts`
- Modify: `server/src/rooms/validation.ts`
- Modify: `server/test/rooms/validation.test.ts`

- [ ] **Step 1: Rewrite validation.ts for InputFrame**

Replace `isValidActionCommand` with `isValidInputFrame`:

```typescript
import type { InputFrame, ResourceType } from "@town-zero/shared";

const RESOURCE_TYPES: ReadonlySet<string> = new Set(["food", "material", "currency"]);
const VALID_DIRECTIONS = new Set(["north", "south", "east", "west"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && Number.isInteger(x)
    && typeof y === "number" && Number.isFinite(y) && Number.isInteger(y);
}

function isValidResource(v: unknown): v is ResourceType {
  return typeof v === "string" && RESOURCE_TYPES.has(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

function isValidAction(action: unknown): boolean {
  if (typeof action !== "object" || action === null) return false;
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case "gather": return isPosition(a.resourceTile);
    case "attack": return typeof a.targetId === "string" && a.targetId.length > 0;
    case "deposit": return typeof a.settlementId === "string" && a.settlementId.length > 0;
    case "take": return typeof a.settlementId === "string" && a.settlementId.length > 0
      && isValidResource(a.resource) && isPositiveInteger(a.amount);
    case "talk": return typeof a.targetId === "string" && a.targetId.length > 0;
    case "trade": return typeof a.targetId === "string" && a.targetId.length > 0
      && isValidResource(a.offer) && isPositiveInteger(a.offerAmount)
      && isValidResource(a.want) && isPositiveInteger(a.wantAmount);
    case "idle": return true;
    default: return false;
  }
}

export function isValidInputFrame(data: unknown): data is InputFrame {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.seq !== "number" || !Number.isInteger(d.seq) || d.seq < 0) return false;

  const hasDirection = d.direction !== undefined;
  const hasAction = d.action !== undefined;
  if (!hasDirection && !hasAction) return false;

  if (hasDirection && !VALID_DIRECTIONS.has(d.direction as string)) return false;
  if (hasAction && !isValidAction(d.action)) return false;

  return true;
}
```

- [ ] **Step 2: Update validation tests**

Rewrite `server/test/rooms/validation.test.ts` to test `isValidInputFrame` instead of `isValidActionCommand`.

- [ ] **Step 3: Rewrite GameRoom message handlers**

In `server/src/rooms/GameRoom.ts`:

1. Replace `"command"`, `"move"`, `"move:stop"` handlers with `"input"` and `"input:stop"`:

```typescript
this.onMessage("input", (client: Client, data: unknown) => {
  const agentId = this.sessionToAgent.get(client.sessionId);
  if (!agentId) return;
  const agent = this.simState.agents.get(agentId);
  if (!agent || !agent.isAlive()) return;
  if (!isValidInputFrame(data)) return;
  agent.enqueueInput(data);
});

this.onMessage("input:stop", (client: Client, data: unknown) => {
  const agentId = this.sessionToAgent.get(client.sessionId);
  if (!agentId) return;
  const agent = this.simState.agents.get(agentId);
  if (!agent) return;
  const seq = typeof data === "object" && data !== null ? (data as any).seq : undefined;
  if (typeof seq === "number") {
    agent.lastProcessedInput = seq;
  }
});
```

2. Remove the `"command"` handler entirely (including the `talk` handling within it).

3. `talk` is now handled inside `executeFrame` (which calls `startDialogue` inline). `processTick` returns talk results via a `talkResults` array. Update the tick method to send dialogue messages from those results:

```typescript
private tick() {
  const talkResults = processTick(this.simState);

  // Send dialogue messages for talk actions executed this tick
  for (const { agentId, targetId, result } of talkResults) {
    if (result.ok) {
      const playerAgent = this.simState.agents.get(agentId);
      const npcAgent = this.simState.agents.get(targetId);
      const playerSchema = this.state.agents.get(agentId);
      const npcSchema = this.state.agents.get(targetId);
      if (playerAgent && playerSchema) syncAgent(playerAgent, playerSchema);
      if (npcAgent && npcSchema) syncAgent(npcAgent, npcSchema);

      if (result.ended) {
        this.sendToAgent(agentId, "dialogue:end", { reason: "completed" });
      } else {
        this.sendToAgent(agentId, "dialogue:state", result.payload);
      }
    }
  }

  const expired = tickDialogues(this.simState);
  // ... rest unchanged
}
```

Note: `processTick` return type changes from `void` to `TalkResult[]`. Import `TalkResult` from `execute-frame.js`.

4. Update `onJoin` to use new agent API:

```typescript
agent.lastProcessedInput = 0;
agent.inputQueue = [];
agent.planBacklog = [];
```

5. Remove the `isValidActionCommand` import, add `isValidInputFrame`.

- [ ] **Step 4: Run all server tests**

Run: `pnpm run test`
Expected: All server tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/GameRoom.ts server/src/rooms/validation.ts server/test/rooms/validation.test.ts
git commit -m "feat(server): replace command/move/move:stop handlers with unified input/input:stop"
```

---

### Task 8: Update session-manager and dialogue-session for new Agent API

**Files:**
- Modify: `server/src/dialogue/session-manager.ts`
- Modify: `server/src/dialogue/dialogue-session.ts`

- [ ] **Step 1: Update session-manager references**

In `server/src/dialogue/session-manager.ts`:

1. Replace `player.moveQueue = []` with `player.inputQueue = []`
2. Remove `player.state = "talking"` — dialogue lock is now via `activeSessions` + `talkingToNpcId` in `executeFrame`
3. Replace `if (player.state === "talking" || player.talkingToNpcId !== null)` with `if (player.talkingToNpcId !== null)` in `startDialogue`

- [ ] **Step 2: Update dialogue-session dispose()**

In `server/src/dialogue/dialogue-session.ts`, the `dispose()` method sets `this._player.state = "idle"`. Since dialogue lock is no longer FSM-based, remove this line. The `talkingToNpcId = null` and `currentTalkingTo = null` cleanup should remain.

- [ ] **Step 2: Run dialogue tests**

Run: `pnpm run test -- server/test/dialogue/session-manager.test.ts`
Expected: Tests pass. Some tests may reference `state === "talking"` and need updating.

- [ ] **Step 3: Fix any failing dialogue tests**

Update test assertions that check `agent.state === "talking"` to instead check `agent.talkingToNpcId !== null`.

- [ ] **Step 4: Commit**

```bash
git add server/src/dialogue/session-manager.ts server/test/dialogue/session-manager.test.ts
git commit -m "fix(server): update session-manager for InputFrame agent API"
```

---

### Task 9: Delete old modules, reduce FSMState, and clean up

**Files:**
- Delete: `server/src/simulation/commands.ts`
- Delete: `server/test/simulation/commands.test.ts`
- Delete: `server/src/simulation/combat.ts`
- Delete: `server/test/simulation/combat.test.ts`
- Modify: `server/src/simulation/resources.ts` (remove `processGathering`)
- Modify: `server/test/simulation/resources.test.ts` (remove gathering tests)
- Modify: `shared/src/types.ts` (remove `ActionCommand`, `PendingInput`, reduce `FSMState` to `idle`/`dead`)
- Modify: `shared/src/constants.ts` (remove `GATHER_DURATION`, `ATTACK_COOLDOWN_TICKS`)
- Modify: `server/src/rooms/schemas/AgentSchema.ts` (remove `currentTargetId`)
- Modify: `server/src/rooms/sync.ts` (remove `currentTargetId` sync)
- Modify: `server/test/rooms/sync.test.ts` (remove `state: "gathering"` test data)
- Modify: `server/test/rooms/game-room.test.ts` (update to new message types)
- Modify: `server/test/integration.test.ts` (update to new command types)
- Modify: `server/test/integration-dialogue.test.ts` (remove `state === "talking"` checks)
- Modify: `server/test/integration-farmer-reed.test.ts` (update if referencing old types)

- [ ] **Step 1: Delete commands.ts and its tests**

```bash
rm server/src/simulation/commands.ts server/test/simulation/commands.test.ts
```

- [ ] **Step 2: Delete combat.ts and its tests**

```bash
rm server/src/simulation/combat.ts server/test/simulation/combat.test.ts
```

- [ ] **Step 3: Remove `processGathering` from resources.ts**

In `server/src/simulation/resources.ts`, delete the `processGathering` function entirely (lines 12–27). Keep `processProduction` and `processConsumption`.

In `server/test/simulation/resources.test.ts`, delete the entire `describe("processGathering", ...)` block.

- [ ] **Step 4: Remove `ActionCommand`, `PendingInput` from shared types; reduce `FSMState`**

In `shared/src/types.ts`:
1. Delete the `ActionCommand` type
2. Delete the `PendingInput` interface
3. Reduce `FSMState` to `"idle" | "dead"` (now safe — all consumers updated in Tasks 1-8)

- [ ] **Step 5: Remove `GATHER_DURATION` and `ATTACK_COOLDOWN_TICKS` from constants**

In `shared/src/constants.ts`, delete these constants and rename `MOVE_QUEUE_CAP` to `INPUT_QUEUE_CAP` if not already done in Task 1.

- [ ] **Step 6: Remove `currentTargetId` from AgentSchema and sync**

In `server/src/rooms/schemas/AgentSchema.ts`, remove `currentTargetId: "string"`.
In `server/src/rooms/sync.ts`, remove `agentSchema.currentTargetId = agent.currentTargetId ?? ""`.

- [ ] **Step 7: Fix all remaining compile errors**

Run: `pnpm run build`
Fix remaining references to deleted types/functions. Affected files:
- `server/test/rooms/sync.test.ts` — remove `state: "gathering"` test data, remove `currentTargetId` assertions
- `server/test/rooms/game-room.test.ts` — update `"command"` / `"move"` / `"move:stop"` to `"input"` / `"input:stop"`
- `server/test/integration.test.ts` — update to use `InputFrame` / `enqueueInput` instead of `ActionCommand` / `setPlan`
- `server/test/integration-dialogue.test.ts` — remove `state === "talking"` checks
- `server/test/integration-farmer-reed.test.ts` — update if referencing old types
- Any file importing `ActionCommand`, `PendingInput`, `GATHER_DURATION`, `ATTACK_COOLDOWN_TICKS`, `MOVE_QUEUE_CAP`

- [ ] **Step 8: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add --all
git commit -m "refactor(server): delete commands.ts, combat.ts, processGathering — all replaced by executeFrame"
```

---

### Task 10: Update client `NetworkClient` for unified messages

**Files:**
- Modify: `client/src/network.ts`

- [ ] **Step 1: Replace send methods**

In `client/src/network.ts`:

1. Replace `send(cmd: ActionCommand)` with `sendInput(frame: InputFrame)`:

```typescript
sendInput(frame: InputFrame): void {
  this.room?.send("input", frame);
}
```

2. Replace `sendMove` and `sendMoveStop`:

```typescript
sendInputStop(seq: number): void {
  this.room?.send("input:stop", { seq });
}
```

3. Remove the old `send`, `sendMove`, `sendMoveStop` methods.
4. Update imports: `ActionCommand` → `InputFrame` from `@town-zero/shared`.

- [ ] **Step 2: Commit**

```bash
git add client/src/network.ts
git commit -m "feat(client): replace send/sendMove/sendMoveStop with sendInput/sendInputStop"
```

---

### Task 11: Update client `InputHandler` for InputFrame

**Files:**
- Modify: `client/src/input.ts`

- [ ] **Step 1: Rewrite InputHandler for InputFrame**

Key changes to `client/src/input.ts`:

1. Replace `onSendMove` / `onSendMoveStop` with `onSendInput: ((frame: InputFrame) => void) | null` and `onSendInputStop: ((seq: number) => void) | null`.
2. Replace `pendingInputs: PendingInput[]` with `pendingInputs: InputFrame[]`.
3. In `update()`, send `InputFrame` with `direction`:

```typescript
++this.inputSeq;
const frame: InputFrame = { seq: this.inputSeq, direction };
this.onSendInput?.(frame);
// ... prediction ...
this.pendingInputs.push(frame);
```

4. Action keys (Q, E, T) now build `InputFrame` instead of calling `this.send`:

```typescript
case "KeyQ": {
  const enemy = this.nearbyEntities.find(/* same logic */);
  if (enemy) {
    ++this.inputSeq;
    this.onSendInput?.({ seq: this.inputSeq, action: { type: "attack", targetId: enemy.id } });
  }
  break;
}
case "KeyT":
  if (this.currentSettlementId) {
    ++this.inputSeq;
    this.onSendInput?.({ seq: this.inputSeq, action: { type: "deposit", settlementId: this.currentSettlementId } });
  }
  break;
case "KeyE":
  this.handleInteract();
  break;
```

5. In `handleInteract()`, build `InputFrame` for gather and talk:

```typescript
// Gather
++this.inputSeq;
this.onSendInput?.({ seq: this.inputSeq, action: { type: "gather", resourceTile: target } });

// Talk
++this.inputSeq;
this.onSendInput?.({ seq: this.inputSeq, action: { type: "talk", targetId: npc.id } });
```

6. Replace `onSendMoveStop` calls with `onSendInputStop`:

```typescript
this.onSendInputStop?.(this.inputSeq);
```

7. Remove the old `send: SendFn` constructor parameter and `SendFn` type — all commands now go through `onSendInput`.

8. Update `handleBlur` and `handleKeyUp` to use `onSendInputStop`.

- [ ] **Step 2: Commit**

```bash
git add client/src/input.ts
git commit -m "feat(client): rewrite InputHandler to send unified InputFrame for all actions"
```

---

### Task 12: Update client `DisplayState` and `main.ts`

**Files:**
- Modify: `client/src/display.ts`
- Modify: `client/test/display.test.ts`
- Modify: `client/src/main.ts`

- [ ] **Step 1: Update DisplayState for InputFrame type**

In `client/src/display.ts`:

1. Replace `PendingInput` import with `InputFrame`.
2. Update `reconcileFromServer` signature: `pendingInputs: InputFrame[]` → same type, but replay only uses `direction` field:

```typescript
reconcileFromServer(
  id: string,
  server: ServerAgent,
  pendingInputs: InputFrame[],
): InputFrame[] {
  // ... same logic, but filter and replay use InputFrame
  // Non-idle: snap to server — but FSMState is now only idle/dead,
  // so check for "dead" instead of checking for "idle"
  if (server.state === "dead") {
    display.displayX = server.x;
    display.displayY = server.y;
    display.facing = server.facing;
    return [];
  }
  // ... rest same, replay only direction field
}
```

- [ ] **Step 2: Update display tests**

In `client/test/display.test.ts`, replace `PendingInput` with `InputFrame`. Update test data to use `InputFrame` format:

```typescript
const pending: InputFrame[] = [
  { seq: 1, direction: "south" },
  { seq: 2, direction: "south" },
];
```

Update the "clears pending when agent state is not idle" test — since FSM will be reduced to idle/dead in Task 9, use `state: "dead"` instead of `state: "fighting"`. This test will remain correct both before and after Task 9's FSMState reduction.

- [ ] **Step 3: Update main.ts wiring**

In `client/src/main.ts`:

1. Replace `InputHandler` constructor: remove the `send` callback (no longer needed):

```typescript
input = new InputHandler();
```

2. Replace `onSendMove`/`onSendMoveStop` with:

```typescript
input.onSendInput = (frame) => network.sendInput(frame);
input.onSendInputStop = (seq) => network.sendInputStop(seq);
```

3. Remove the `network.send(cmd)` callback.

4. For trade modal, build `InputFrame` and send via `network.sendInput`:

```typescript
document.getElementById("sell-food-btn")!.addEventListener("click", () => {
  if (currentTradeTarget && input) {
    ++input.inputSeq;
    network.sendInput({
      seq: input.inputSeq,
      action: {
        type: "trade", targetId: currentTradeTarget,
        offer: "food", offerAmount: MERCHANT_TRADE_RATE,
        want: "currency", wantAmount: 1,
      },
    });
    closeTradeModal();
  }
});
```

Do the same for `sell-material-btn`.

- [ ] **Step 4: Run client tests**

Run: `pnpm run test -- client/test/display.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/display.ts client/test/display.test.ts client/src/main.ts
git commit -m "feat(client): update DisplayState and main.ts for InputFrame reconciliation"
```

---

### Task 13: Update CLAUDE.md and add TODO for tile resource regeneration

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Update these sections in the worktree's `CLAUDE.md`:

1. **Simulation flow** — replace phase descriptions:
   - Phase 1: "Consume one InputFrame per agent (unified movement + actions, all instant)"
   - Phase 1.5: Remove entirely
   - Phase 2: "Bot controller produces FrameAction[] → planBacklog"
   - Phases 3–8: unchanged

2. **Unified ActionCommand** paragraph — replace with:
   > **Unified InputFrame:** All entities (players, LLM-driven NPCs, bots) produce the same `InputFrame` type containing optional `direction` and/or `action`. The simulation loop consumes one frame per agent per tick. All actions are instant (1 tick). `planBacklog` stores LLM/bot multi-step strategies that auto-shift into the input queue one per tick.

3. **Per-tick movement bullet** — replace with:
   > **Per-tick InputFrame (Gambetta reconciliation):** Client sends `input` messages (with seq number) containing direction and/or action. Server consumes one from `agent.inputQueue` per tick, advancing `agent.lastProcessedInput`. Client reconciles by accepting server position as baseline, pruning acknowledged inputs, and replaying the rest. `input:stop` with seq stops held-key frame generation. `planBacklog` frames use `seq=0` (not tracked by reconciliation).

4. **Key-state movement bullet** — delete (replaced by above)

5. **Display.ts bullet** — update to reference `InputFrame` instead of `PendingInput`

6. **Input.ts bullet** — update to describe `onSendInput` callback and InputFrame assembly

7. **Dialogue system bullet** — update to note `talk` is now a FrameAction processed in tick Phase 1, not immediate in GameRoom.onMessage

8. Add to **TODO** section:
   > - [ ] **Tile resource regeneration:** Bushes currently provide infinite resources. Add resource quantity per tile, depletion on gather, and time-based regeneration. Part of the future TileObject system.

9. Update the `planBacklog` description — it's now `InputFrame[]` (can include direction), not `FrameAction[]`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for InputFrame architecture, add resource regen + bot pathfinding TODOs"
```

---

### Task 14: Full test suite verification and build

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass with 0 failures.

- [ ] **Step 2: Run build**

Run: `pnpm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Fix any remaining issues**

If any tests fail or build errors remain, fix them. Common issues:
- Stale imports of `ActionCommand` or `PendingInput` in files not yet updated
- Integration tests referencing old message types (`"command"`, `"move"`)
- Test files importing from deleted modules (`commands.js`, `combat.js`)

- [ ] **Step 4: Final commit if fixes were needed**

```bash
git add --all
git commit -m "fix: resolve remaining type errors and test failures from InputFrame migration"
```
