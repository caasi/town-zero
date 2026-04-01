import { describe, it, expect } from "vitest";
import { spawnMerchant, processMerchantTick } from "../../src/simulation/tick.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function makeWorldWithRoad(): SimulationState {
  const grid = new Grid(10, 10);
  for (let x = 0; x <= 9; x++) {
    grid.setTerrain(x, 5, "road");
  }

  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }] });
  settlement.addResource("food", 10);
  settlement.addResource("material", 10);

  return { grid, agents: new Map(), settlements: new Map([["v1", settlement]]), tick: 0, nextMerchantId: 0 };
}

describe("spawnMerchant", () => {
  it("creates a merchant agent at map edge", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchants = Array.from(state.agents.values()).filter((a) => a.role === "merchant");
    expect(merchants).toHaveLength(1);
    expect(merchants[0].position.x).toBe(0);
    expect(merchants[0].inventory.currency).toBeGreaterThan(0);
  });
});

describe("processMerchantTick", () => {
  it("merchant moves forward each tick", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchant = Array.from(state.agents.values()).find((a) => a.role === "merchant")!;
    const startX = merchant.position.x;
    processMerchantTick(merchant, state);
    expect(merchant.position.x).toBe(startX + 1);
  });

  it("merchant does not auto-trade with settlement", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchant = Array.from(state.agents.values()).find((a) => a.role === "merchant")!;
    merchant.position = { x: 5, y: 5 };
    const villageFoodBefore = state.settlements.get("v1")!.inventory.food;
    processMerchantTick(merchant, state);
    // settlement inventory unchanged — no auto-trade
    expect(state.settlements.get("v1")!.inventory.food).toBe(villageFoodBefore);
    expect(state.settlements.get("v1")!.inventory.currency).toBe(0);
  });

  it("merchant is removed when reaching map edge", () => {
    const state = makeWorldWithRoad();
    spawnMerchant(state);
    const merchant = Array.from(state.agents.values()).find((a) => a.role === "merchant")!;
    merchant.position = { x: 9, y: 5 };
    processMerchantTick(merchant, state);
    expect(state.agents.has(merchant.id)).toBe(false);
  });
});
