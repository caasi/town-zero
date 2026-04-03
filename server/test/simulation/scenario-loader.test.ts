import { describe, it, expect } from "vitest";
import { loadScenario } from "../../src/simulation/scenario-loader.js";
import type { ScenarioData } from "@town-zero/shared";
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
    const data: ScenarioData = {
      id: "test",
      npcs: [
        {
          id: "elder",
          role: "merchant",
          faction: "v1",
          position: { x: 5, y: 5 },
          initialBeliefs: [{ key: "is_elder", value: true }],
          dialogueIds: ["talk"],
        },
      ],
      dialogues: [
        {
          id: "talk",
          root: "hi",
          nodes: {
            hi: {
              type: "text",
              speaker: "npc",
              content: ["Hello"],
              next: "done",
            },
            done: { type: "end" },
          },
          triggers: [],
        },
      ],
      triggers: [],
    };

    const state = makeState();
    const result = loadScenario(data, state);

    expect(state.agents.has("elder")).toBe(true);
    const agent = state.agents.get("elder")!;
    expect(agent.faction).toBe("v1");
    expect(agent.getBelief("is_elder")?.value).toBe(true);
    expect(result.triggerRegistry.getAll().length).toBe(0);
  });

  it("registers scenario-level triggers", () => {
    const data: ScenarioData = {
      id: "test",
      npcs: [
        {
          id: "a",
          role: "scout",
          faction: "v1",
          position: { x: 0, y: 0 },
          initialBeliefs: [],
          dialogueIds: ["d"],
        },
      ],
      dialogues: [
        {
          id: "d",
          root: "hi",
          nodes: {
            hi: {
              type: "text",
              speaker: "npc",
              content: ["Hello"],
              next: "done",
            },
            done: { type: "end" },
          },
          triggers: [],
        },
      ],
      triggers: [
        {
          id: "scenario:test:0",
          when: {
            type: "compare",
            op: "eq",
            left: { type: "fact_ref", key: "x" },
            right: { type: "literal", value: true },
          },
          then: [
            {
              type: "set_fact",
              target: "a",
              key: "y",
              value: { type: "literal", value: true },
            },
          ],
          targets: ["a"],
          once: true,
          source: "scenario",
          fired: false,
        },
      ],
    };

    const state = makeState();
    const result = loadScenario(data, state);
    expect(result.triggerRegistry.getAll()).toHaveLength(1);
  });

  it("registers dialogue-scoped triggers", () => {
    const data: ScenarioData = {
      id: "test",
      npcs: [
        {
          id: "a",
          role: "scout",
          faction: "v1",
          position: { x: 0, y: 0 },
          initialBeliefs: [],
          dialogueIds: ["d"],
        },
      ],
      dialogues: [
        {
          id: "d",
          root: "hi",
          nodes: {
            hi: {
              type: "text",
              speaker: "npc",
              content: ["Hello"],
              next: "done",
            },
            done: { type: "end" },
          },
          triggers: [
            {
              id: "scenario:test:dialogue:d:0",
              when: {
                type: "compare",
                op: "eq",
                left: { type: "fact_ref", key: "x" },
                right: { type: "literal", value: true },
              },
              then: [
                {
                  type: "set_fact",
                  target: "$npc",
                  key: "y",
                  value: { type: "literal", value: true },
                },
              ],
              targets: ["a"],
              once: true,
              source: "scenario",
              fired: false,
            },
          ],
        },
      ],
      triggers: [],
    };

    const state = makeState();
    const result = loadScenario(data, state);
    expect(result.triggerRegistry.getAll()).toHaveLength(1);
  });

  it("stores dialogue trees by ID", () => {
    const data: ScenarioData = {
      id: "test",
      npcs: [
        {
          id: "a",
          role: "scout",
          faction: "v1",
          position: { x: 0, y: 0 },
          initialBeliefs: [],
          dialogueIds: ["d1", "d2"],
        },
      ],
      dialogues: [
        {
          id: "d1",
          root: "hi",
          nodes: {
            hi: {
              type: "text",
              speaker: "npc",
              content: ["Hello"],
              next: "done",
            },
            done: { type: "end" },
          },
          triggers: [],
        },
        {
          id: "d2",
          root: "yo",
          nodes: {
            yo: {
              type: "text",
              speaker: "npc",
              content: ["Yo"],
              next: "end",
            },
            end: { type: "end" },
          },
          triggers: [],
        },
      ],
      triggers: [],
    };

    const state = makeState();
    const result = loadScenario(data, state);
    expect(result.dialogueTrees.size).toBe(2);
    expect(result.dialogueTrees.has("d1")).toBe(true);
    expect(result.dialogueTrees.has("d2")).toBe(true);
  });

  it("sets NPC position and role correctly", () => {
    const data: ScenarioData = {
      id: "test",
      npcs: [
        {
          id: "guard",
          role: "scout",
          faction: "v2",
          position: { x: 10, y: 15 },
          initialBeliefs: [],
          dialogueIds: [],
        },
      ],
      dialogues: [],
      triggers: [],
    };

    const state = makeState();
    loadScenario(data, state);

    const agent = state.agents.get("guard")!;
    expect(agent.position).toEqual({ x: 10, y: 15 });
    expect(agent.role).toBe("scout");
    expect(agent.controller).toBe("bot");
  });
});
