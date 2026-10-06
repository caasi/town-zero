import { describe, it, expect } from "vitest";
import {
  scenario, belief, setFact, give, take, when, fact, local, player, t,
} from "@town-zero/shared/script-dsl";
import type { Fact, DialogueProgressEntry } from "@town-zero/shared";

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
        d.end("end_node");
      });
    });

    const json = JSON.stringify(data);
    const restored = JSON.parse(json);
    expect(restored).toEqual(data);
  });

  it("Fact survives JSON round-trip", () => {
    const f: Fact = { key: "bridge", value: "destroyed", tick: 42, source: "scout_a" };
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
  });

  it("DialogueProgressEntry survives JSON round-trip", () => {
    const entry: DialogueProgressEntry = {
      visitedNodes: ["greeting", "main"],
      selectedOptions: { main: "opt_0" },
      locals: { cost: 5, name: "Marcus" },
    };
    expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
  });
});
