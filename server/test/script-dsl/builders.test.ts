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
      expect(dialogue.nodes["trigger"]).toBeUndefined();
      expect(dialogue.triggers).toHaveLength(1);
      const t1 = dialogue.nodes["t1"];
      if (t1.type === "text") {
        expect(t1.next).toBe("t2");
      }
    });

    it("throws on empty dialogue (no nodes)", () => {
      expect(() => scenario("empty-dialogue", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (_d) => {
          // no nodes registered
        });
      })).toThrow(/must contain at least one node/);
    });

    it("throws when text node has dangling next (auto-chain not resolved)", () => {
      expect(() => scenario("dangling", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.text("only", t`Hello`);
          // no end node, auto-chain leaves next: ""
        });
      })).toThrow(/missing a next node/);
    });

    it("throws when option has no goto()", () => {
      expect(() => scenario("no-goto", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.choice("ch", [
            d.option("Option A"),
          ]);
          d.end("end");
        });
      })).toThrow(/missing goto/);
    });

    it("throws on dialogue for unregistered NPC", () => {
      expect(() => scenario("unregistered", (s) => {
        s.dialogue("ghost_npc", "d", (d) => {
          d.text("hi", t`Hello`);
          d.end("done");
        });
      })).toThrow(/unregistered NPC/);
    });

    it("throws on duplicate dialogue ID", () => {
      expect(() => scenario("dup-dialogue", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "talk", (d) => { d.text("hi", t`Hi`); d.end("done"); });
        s.dialogue("a", "talk", (d) => { d.text("yo", t`Yo`); d.end("end"); });
      })).toThrow(/Duplicate dialogueId/);
    });

    it("throws on duplicate NPC ID", () => {
      expect(() => scenario("dup-npc", (s) => {
        s.npc("a", { role: "scout", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.npc("a", { role: "merchant", faction: "f", position: { x: 1, y: 0 }, initialBeliefs: [] });
      })).toThrow(/Duplicate npcId/);
    });

    it("d.entry() adds entryPoints to dialogue tree", () => {
      const data = scenario("entry-test", (s) => {
        s.npc("a", { role: "farmer", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
        s.dialogue("a", "d", (d) => {
          d.text("greeting", ["Hello!"], { next: "done" });
          d.text("alt-entry", ["Welcome back!"], { next: "done" });
          d.end("done");
          d.entry("alt-entry", fact("quest_active").eq(true));
        });
      });

      const tree = data.dialogues[0];
      expect(tree.root).toBe("greeting");
      expect(tree.entryPoints).toHaveLength(1);
      expect(tree.entryPoints![0].nodeId).toBe("alt-entry");
      expect(tree.entryPoints![0].condition).toEqual({
        type: "compare",
        op: "eq",
        left: { type: "fact_ref", key: "quest_active" },
        right: { type: "literal", value: true },
      });
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
