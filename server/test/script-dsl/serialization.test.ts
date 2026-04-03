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
