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
      nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
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

    expect(scout.getBelief("bridge_status")).toBeUndefined();

    elder.mergeBeliefs(scout.getAllBeliefs());
    scout.mergeBeliefs(elder.getAllBeliefs());

    expect(scout.getBelief("bridge_status")?.value).toBe("intact");
    expect(elder.getBelief("patrol_route")?.value).toBe("north");
  });

  it("trigger registry detects changed facts", () => {
    const { triggerRegistry } = setup();
    expect(triggerRegistry.getAll()).toHaveLength(1);
  });
});
