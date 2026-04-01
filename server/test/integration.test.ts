import { describe, it, expect } from "vitest";
import { generateMap } from "../src/map/generator.js";
import { processTick } from "../src/simulation/tick.js";

describe("Full simulation integration", () => {
  it("runs 100 ticks without crashing", () => {
    const state = generateMap();
    for (let i = 0; i < 100; i++) {
      processTick(state);
    }
    expect(state.tick).toBe(100);
  });

  it("village has agents alive after 50 ticks with food", () => {
    const state = generateMap();
    for (let i = 0; i < 50; i++) {
      processTick(state);
    }
    const villageAgents = Array.from(state.agents.values()).filter(
      (a) => a.faction === "village-1" && a.isAlive(),
    );
    expect(villageAgents.length).toBeGreaterThan(0);
  });

  it("agents build up map memory over time", () => {
    const state = generateMap();
    for (let i = 0; i < 10; i++) {
      processTick(state);
    }
    const agent = Array.from(state.agents.values())[0];
    expect(agent.getAllMemory().size).toBeGreaterThan(0);
  });
});
