import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";

describe("Agent.setBubble", () => {
  it("sets bubbleText and computes bubbleExpiresAt from current tick", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("早安", 80, /*currentTick*/ 100);
    expect(a.bubbleText).toBe("早安");
    expect(a.bubbleExpiresAt).toBe(180);
  });

  it("clears immediately when text is empty or duration is zero", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.setBubble("hi", 10, 0);
    a.setBubble("", 0, 5);
    expect(a.bubbleText).toBeNull();
    expect(a.bubbleExpiresAt).toBe(0);
  });

  it("truncates overlong text to the schema cap", () => {
    const a = new Agent({ id: "a", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const long = "x".repeat(200);
    a.setBubble(long, 10, 0);
    expect(a.bubbleText!.length).toBeLessThanOrEqual(64);
  });
});

describe("Agent.proximityBubble", () => {
  it("exposes a typed proximityBubble config field (optional)", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    expect(a.proximityBubble).toBeUndefined();
  });

  it("tracks last trigger tick per player in the proximity ledger", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    expect(a.getLastProximityTrigger("p1")).toBe(100);
    expect(a.getLastProximityTrigger("p2")).toBeUndefined();
  });

  it("removes a player from the ledger on disconnect-cleanup", () => {
    const a = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    a.recordProximityTrigger("p1", 100);
    a.forgetPlayerProximity("p1");
    expect(a.getLastProximityTrigger("p1")).toBeUndefined();
  });
});
