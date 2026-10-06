import { describe, it, expect } from "vitest";
import { loadScenario } from "../../src/simulation/scenario-loader.js";
import type { ScenarioData } from "@town-zero/shared";
import { scenario, bubble } from "@town-zero/shared/script-dsl";
import type { SimulationState } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";

function makeState(): SimulationState {
  return {
    grid: new Grid(20, 20),
    agents: new Map(),
    settlements: new Map(),
    tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
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
        },
      ],
    };

    const state = makeState();
    loadScenario(data, state);

    expect(state.agents.has("elder")).toBe(true);
    const agent = state.agents.get("elder")!;
    expect(agent.faction).toBe("v1");
    expect(agent.getBelief("is_elder")?.value).toBe(true);
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
        },
      ],
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
    };

    const state = makeState();
    loadScenario(data, state);

    const agent = state.agents.get("guard")!;
    expect(agent.position).toEqual({ x: 10, y: 15 });
    expect(agent.role).toBe("scout");
    expect(agent.controller).toBe("bot");
  });
});

describe("loadScenario — handler registration", () => {
  it("registers NPC .on() handlers into agent.eventHandlers", () => {
    const state = makeState();
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
