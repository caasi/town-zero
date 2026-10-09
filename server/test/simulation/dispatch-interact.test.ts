// server/test/simulation/dispatch-interact.test.ts
import { describe, it, expect } from "vitest";
import { dispatchInteract } from "../../src/simulation/dispatch-interact.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { FrameContext, TalkResult } from "../../src/simulation/execute-frame.js";
import { BASE_ATTACK_DAMAGE, ZoneType } from "@town-zero/shared";
import { Settlement } from "../../src/simulation/settlement.js";
import type { DialogueTreeData } from "@town-zero/shared";

function makeState(overrides?: Partial<SimulationState>): SimulationState {
  return {
    grid: new Grid(10, 10),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    activeSessions: new Map(),
    dialogueTrees: new Map(),
    ...overrides,
  };
}

function makeCtx(
  agent: Agent,
  state: SimulationState,
  talkResults: TalkResult[] = [],
): FrameContext {
  return {
    grid: state.grid,
    agent,
    agents: state.agents,
    settlements: state.settlements,
    activeSessions: state.activeSessions,
    simState: state,
    talkResults,
  };
}

describe("dispatchInteract — priority order", () => {
  it("rule 1: alive target with matching dialogue entry → talk", () => {
    const state = makeState();
    // Agent at (5,5) facing south → facing tile is (5,6)
    const agent = new Agent({ id: "p1", position: { x: 5, y: 5 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "south";
    const npc = new Agent({ id: "npc-1", position: { x: 5, y: 6 }, faction: "v1", role: "farmer", controller: "llm" });
    state.agents.set("p1", agent);
    state.agents.set("npc-1", npc);

    // Build a tree with an always-true entryPoint.
    // TextTemplate is string[] | TextTemplatePart[] — a simple string array works.
    const tree: DialogueTreeData = {
      id: "npc-1-tree",
      root: "start",
      nodes: {
        start: { type: "text", speaker: "npc", content: ["Hello!"], next: "end" },
        end: { type: "end" },
      },
      entryPoints: [
        {
          condition: { type: "compare", op: "eq", left: { type: "literal", value: 1 }, right: { type: "literal", value: 1 } },
          nodeId: "start",
        },
      ],
    } as any;
    state.dialogueTrees.set("npc-1-tree", tree);

    const talkResults: TalkResult[] = [];
    dispatchInteract(makeCtx(agent, state, talkResults));

    // Should have started a dialogue session
    expect(state.activeSessions.has("npc-1")).toBe(true);
    expect(talkResults).toHaveLength(1);
    expect(talkResults[0].agentId).toBe("p1");
    expect(talkResults[0].targetId).toBe("npc-1");
    // HP unchanged — this is talk, not attack
    expect(npc.hp).toBe(100);
  });

  it("rule 2: alive target, different faction, no entry → attack", () => {
    const state = makeState();
    // Agent at (1,1) facing east → facing tile is (2,1)
    const agent = new Agent({ id: "p1", position: { x: 1, y: 1 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "east";
    const enemy = new Agent({ id: "enemy-1", position: { x: 2, y: 1 }, faction: "den-1", role: "beast", controller: "bot" });
    state.agents.set("p1", agent);
    state.agents.set("enemy-1", enemy);
    // No dialogue tree for enemy → no entry match

    const talkResults: TalkResult[] = [];
    dispatchInteract(makeCtx(agent, state, talkResults));

    expect(enemy.hp).toBe(100 - BASE_ATTACK_DAMAGE);
    expect(talkResults).toHaveLength(0);
  });

  it("rule 3: alive target, same faction, no entry → noop (no HP change, no dialogue)", () => {
    const state = makeState();
    // Agent at (3,3) facing north → facing tile is (3,2)
    const agent = new Agent({ id: "p1", position: { x: 3, y: 3 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "north";
    const ally = new Agent({ id: "ally-1", position: { x: 3, y: 2 }, faction: "v1", role: "farmer", controller: "llm" });
    state.agents.set("p1", agent);
    state.agents.set("ally-1", ally);
    // No dialogue tree → hasMatchingDialogueEntry returns false → rule 4 (same faction, no entry)

    const talkResults: TalkResult[] = [];
    dispatchInteract(makeCtx(agent, state, talkResults));

    expect(ally.hp).toBe(100);
    expect(talkResults).toHaveLength(0);
    expect(state.activeSessions.size).toBe(0);
  });

  it("rule 4: resource tile (bush) → gather adds inventory", () => {
    const state = makeState();
    // Agent at (5,5) facing south → facing tile is (5,6) with food resource
    const agent = new Agent({ id: "p1", position: { x: 5, y: 5 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "south";
    state.grid.setResourceYield(5, 6, "food");
    state.agents.set("p1", agent);
    // No occupant on (5,6)

    dispatchInteract(makeCtx(agent, state));

    expect(agent.inventory.food).toBe(1);
  });

  it("rule 5: empty tile → noop", () => {
    const state = makeState();
    // Agent at (5,5) facing south → facing tile is (5,6) — nothing there
    const agent = new Agent({ id: "p1", position: { x: 5, y: 5 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "south";
    state.agents.set("p1", agent);

    const talkResults: TalkResult[] = [];
    dispatchInteract(makeCtx(agent, state, talkResults));

    expect(agent.inventory.food).toBe(0);
    expect(agent.inventory.material).toBe(0);
    expect(talkResults).toHaveLength(0);
  });

  it("dead agent on facing tile is invisible to dispatcher", () => {
    const state = makeState();
    // Agent at (5,5) facing south → facing tile is (5,6)
    // Dead enemy at (5,6) — dispatcher skips it and falls through to rule 5 (resource)
    const agent = new Agent({ id: "p1", position: { x: 5, y: 5 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "south";
    const dead = new Agent({ id: "enemy-1", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot", hp: 0 });
    state.grid.setResourceYield(5, 6, "material");
    state.agents.set("p1", agent);
    state.agents.set("enemy-1", dead);

    dispatchInteract(makeCtx(agent, state));

    // Dead agent should not block gather — inventory gains material
    expect(agent.inventory.material).toBe(1);
    // Dead agent HP remains at 0 (not attacked further)
    expect(dead.hp).toBe(0);
  });
});

describe("dispatchInteract — deposit on a housing cell", () => {
  // Player at (5,5) on a housing cell of den-1, facing south → (5,6).
  function setup() {
    const state = makeState();
    const agent = new Agent({ id: "p1", position: { x: 5, y: 5 }, faction: "v1", role: "player", controller: "player" });
    agent.facing = "south";
    agent.addToInventory("food", 3);
    agent.addToInventory("material", 2);
    state.agents.set("p1", agent);
    state.grid.setZoneType(5, 5, ZoneType.HOUSING);
    const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 5, y: 5 }] });
    state.settlements.set("den-1", den);
    return { state, agent, den };
  }

  it("deposits everything into the settlement that owns the cell, any faction", () => {
    const { state, agent, den } = setup();
    dispatchInteract(makeCtx(agent, state));
    expect(agent.inventory.food).toBe(0);
    expect(den.inventory.food).toBe(3);
    expect(den.inventory.material).toBe(2);
  });

  it("a same-faction agent with no dialogue in front does not block deposit", () => {
    const { state, agent, den } = setup();
    state.agents.set("ally-1", new Agent({ id: "ally-1", position: { x: 5, y: 6 }, faction: "v1", role: "farmer", controller: "llm" }));
    dispatchInteract(makeCtx(agent, state));
    expect(den.inventory.food).toBe(3);
  });

  it("gather in front wins over deposit", () => {
    const { state, agent, den } = setup();
    state.grid.setResourceYield(5, 6, "food");
    dispatchInteract(makeCtx(agent, state));
    expect(agent.inventory.food).toBe(4);
    expect(den.inventory.food).toBe(0);
  });

  it("a used-up resource in front does not block deposit", () => {
    const { state, agent, den } = setup();
    state.grid.setResourceYield(5, 6, "food");
    while (state.grid.takeResource(5, 6)) { /* use the tile up */ }
    dispatchInteract(makeCtx(agent, state));
    expect(den.inventory.food).toBe(3);
  });

  it("an enemy in front is attacked, not deposited to", () => {
    const { state, agent, den } = setup();
    const enemy = new Agent({ id: "e1", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
    state.agents.set("e1", enemy);
    dispatchInteract(makeCtx(agent, state));
    expect(enemy.hp).toBe(100 - BASE_ATTACK_DAMAGE);
    expect(den.inventory.food).toBe(0);
  });

  it("a territory cell that is not housing does not deposit", () => {
    const { state, agent, den } = setup();
    state.grid.setZoneType(5, 5, ZoneType.EMPTY);
    dispatchInteract(makeCtx(agent, state));
    expect(agent.inventory.food).toBe(3);
    expect(den.inventory.food).toBe(0);
  });
});
