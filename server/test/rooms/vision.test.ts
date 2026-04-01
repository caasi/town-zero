import { describe, it, expect } from "vitest";
import { extractVisionForPlayer } from "../../src/rooms/vision.js";
import { Agent } from "../../src/simulation/agent.js";

describe("extractVisionForPlayer", () => {
  it("returns empty tiles for agent with no memory", () => {
    const agent = new Agent({
      id: "a1", position: { x: 5, y: 5 },
      faction: "village-1", role: "farmer", controller: "player",
    });
    const result = extractVisionForPlayer(agent, 10);
    expect(result.tick).toBe(10);
    expect(Object.keys(result.tiles)).toHaveLength(0);
  });

  it("converts MapMemory to plain Record", () => {
    const agent = new Agent({
      id: "a1", position: { x: 5, y: 5 },
      faction: "village-1", role: "farmer", controller: "player",
    });
    agent.recordTile(3, 4, "forest", [{ id: "a2", type: "agent", faction: "den-1", position: { x: 3, y: 4 } }], 5);
    agent.recordTile(5, 5, "plains", [], 5);

    const result = extractVisionForPlayer(agent, 5);
    expect(result.tick).toBe(5);
    expect(Object.keys(result.tiles)).toHaveLength(2);
    expect(result.tiles["3,4"].terrain).toBe("forest");
    expect(result.tiles["3,4"].entities).toHaveLength(1);
    expect(result.tiles["3,4"].entities[0].id).toBe("a2");
    expect(result.tiles["5,5"].terrain).toBe("plains");
  });
});
