import { describe, it, expect } from "vitest";
import { bubble } from "@town-zero/shared/script-dsl";

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
