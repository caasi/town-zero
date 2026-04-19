import { describe, it, expect } from "vitest";
import { hasMatchingDialogueEntry } from "../../src/simulation/dialogue-entry-predicate.js";
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

  it("returns false for entry-less trees (rule 2 fall-through)", () => {
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
        { condition: { type: "compare", op: "eq", left: { type: "fact_ref", key: "wants_parley" }, right: { type: "literal", value: true } }, nodeId: "surrender" },
      ],
    } as any;
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f1", role: "villager", controller: "bot" });
    npc.setBelief("wants_parley", { key: "wants_parley", value: true, tick: 0, source: "test" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "f2", role: "player", controller: "player" });
    const state = buildState(tree, npc, player);
    expect(hasMatchingDialogueEntry(player, npc, state)).toBe(true);
  });
});
