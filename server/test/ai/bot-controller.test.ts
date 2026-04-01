import { describe, it, expect } from "vitest";
import { decideBotAction } from "../../src/ai/bot-controller.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";

describe("decideBotAction", () => {
  it("returns move toward settlement when food is low", () => {
    const agent = new Agent({ id: "a1", position: { x: 7, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("move");
    if (cmd.type === "move") {
      expect(cmd.target.x).toBe(6);
    }
  });

  it("returns idle when already in settlement territory with food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    agent.addToInventory("food", 5);
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("idle");
  });

  it("returns take when in settlement with no personal food but settlement has food", () => {
    const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "bot" });
    const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
    settlement.addResource("food", 10);
    const cmd = decideBotAction(agent, settlement);
    expect(cmd.type).toBe("take");
  });
});
