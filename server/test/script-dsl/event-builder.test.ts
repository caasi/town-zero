import { describe, it, expect } from "vitest";
import { bubble, scenario } from "@town-zero/shared/script-dsl";

describe("bubble() effect factory", () => {
  it("returns a bubble Effect with target/text/durationTicks", () => {
    const eff = bubble("npc-1", "hello", { durationTicks: 40 });
    expect(eff).toEqual({ type: "bubble", target: "npc-1", text: "hello", durationTicks: 40 });
  });

  it("accepts durationTicks: 0 for clear", () => {
    const eff = bubble("npc-1", "", { durationTicks: 0 });
    expect(eff.durationTicks).toBe(0);
  });
});

describe("s.npc().on() chaining", () => {
  it("returns builder from .on() so calls chain", () => {
    const data = scenario("test", (s) => {
      const b = s.npc("n1", { role: "villager", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] });
      const chained = b.on("proximity:enter", ({ self }) => [bubble(self.id, "hi", { durationTicks: 10 })]);
      expect(chained).toBe(b);
    });
    const npc = data.npcs[0];
    expect(npc.handlers).toHaveLength(1);
    expect(npc.handlers![0].event).toBe("proximity:enter");
  });

  it("accepts multiple overloads with distinct payload types", () => {
    const data = scenario("test", (s) => {
      s.npc("n1", { role: "villager", faction: "f", position: { x: 0, y: 0 }, initialBeliefs: [] })
        .on("proximity:enter", ({ player }) => { void player.id; return []; })
        .on("talk:start",      ({ dialogueId }) => { void dialogueId; return []; })
        .on("combat:hit",      ({ hpAfter }) => { void hpAfter; return []; });
    });
    expect(data.npcs[0].handlers).toHaveLength(3);
  });
});
