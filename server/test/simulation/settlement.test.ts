import { describe, it, expect } from "vitest";
import { Settlement } from "../../src/simulation/settlement.js";

describe("Settlement", () => {
  function makeSettlement() {
    return new Settlement({
      id: "village-1",
      faction: "village-1",
      type: "village",
      territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 6, y: 6 }],
    });
  }

  it("creates settlement with empty inventory", () => {
    const s = makeSettlement();
    expect(s.inventory).toEqual({ food: 0, material: 0, currency: 0 });
  });

  it("checks if position is in territory", () => {
    const s = makeSettlement();
    expect(s.isInTerritory({ x: 5, y: 5 })).toBe(true);
    expect(s.isInTerritory({ x: 0, y: 0 })).toBe(false);
  });

  it("calculates population cap from housing", () => {
    const s = makeSettlement();
    expect(s.getPopulationCap()).toBe(0);
    s.addStructure({ id: "h1", type: "housing", position: { x: 5, y: 5 } });
    expect(s.getPopulationCap()).toBe(6);
    s.addStructure({ id: "h2", type: "housing", position: { x: 5, y: 6 } });
    expect(s.getPopulationCap()).toBe(12);
  });

  it("adds and removes resources", () => {
    const s = makeSettlement();
    s.addResource("food", 10);
    expect(s.inventory.food).toBe(10);
    expect(s.removeResource("food", 5)).toBe(true);
    expect(s.inventory.food).toBe(5);
    expect(s.removeResource("food", 10)).toBe(false);
  });
});
