import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/ai/prompt-builder.js";
import { Agent } from "../../src/simulation/agent.js";

describe("buildPrompt", () => {
  it("includes agent identity and position", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 0);
    expect(prompt).toContain("farmer");
    expect(prompt).toContain("(5, 5)");
  });

  it("includes inventory info", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.addToInventory("food", 3);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 0);
    expect(prompt).toContain("food");
    expect(prompt).toContain("3");
  });

  it("includes visible entities from memory", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.recordTile(6, 5, "plains", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 6, y: 5 } }], 100);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 100);
    expect(prompt).toContain("(6, 5)");
    expect(prompt).toContain("monster");
  });

  it("distinguishes current vision from stale memory", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.recordTile(6, 5, "plains", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 6, y: 5 } }], 50);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 100);
    expect(prompt).toContain("remember");
  });

  it("lists available actions", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 0);
    expect(prompt).toContain("move");
    expect(prompt).toContain("gather");
  });

  it("clamps ticksAgo to zero when currentTick < timestamp", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "llm" });
    agent.recordTile(6, 5, "plains", [{ id: "m1", type: "monster", faction: "den-1", position: { x: 6, y: 5 } }], 200);
    const prompt = buildPrompt(agent, { food: 10, material: 5, currency: 2 }, 100);
    // Should NOT contain negative ticks
    expect(prompt).not.toMatch(/-\d+ ticks ago/);
    expect(prompt).toContain("0 ticks ago");
  });
});
