import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildOptions, nextFrame } from "../../src/ai/jev-controller.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";

// The rule behind every Jev option: it must yield at least one frame now.
// An option that ends at once makes the agent ask again, and asks cost money.

const SIZE = 20;
const pos = fc.record({ x: fc.integer({ min: 0, max: SIZE - 1 }), y: fc.integer({ min: 0, max: SIZE - 1 }) });

const world = fc.record({
  water: fc.array(pos, { maxLength: SIZE * SIZE / 2 }),
  beast: pos,
  // Random water alone seldom blocks a path; wall off some sides of the beast.
  walls: fc.subarray([[1, 0], [-1, 0], [0, 1], [0, -1]]),
  carried: fc.integer({ min: 0, max: 7 }),
  denFood: fc.integer({ min: 0, max: 20 }),
  enemies: fc.array(fc.record({ at: pos, seenNow: fc.boolean() }), { maxLength: 3 }),
  foodTiles: fc.array(pos, { maxLength: 4 }),
  rand: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
});

type World = typeof world extends fc.Arbitrary<infer T> ? T : never;

function build(w: World): { state: SimulationState; beast: Agent } {
  const grid = new Grid(SIZE, SIZE);
  for (const p of w.water) grid.setTerrain(p.x, p.y, "water");
  for (const [dx, dy] of w.walls) {
    const x = w.beast.x + dx, y = w.beast.y + dy;
    if (grid.inBounds(x, y)) grid.setTerrain(x, y, "water");
  }
  const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 2, y: 2 }, { x: 3, y: 2 }] });
  den.addStructure({ id: "core", type: "core", position: { x: 2, y: 2 } });
  den.addResource("food", w.denFood);
  const beast = new Agent({ id: "b1", position: w.beast, faction: "den-1", role: "beast", controller: "llm" });
  beast.addToInventory("food", w.carried);
  den.populationIds.push("b1");
  const tick = 100;
  const agents = new Map([["b1", beast]]);
  w.enemies.forEach((e, i) => {
    const enemy = new Agent({ id: `p${i}`, position: e.at, faction: "village-1", role: "player", controller: "player" });
    agents.set(enemy.id, enemy);
    beast.recordTile(e.at.x, e.at.y, "plains",
      [{ id: enemy.id, type: "agent", faction: enemy.faction, position: { ...e.at }, role: enemy.role, hp: enemy.hp, maxHp: enemy.maxHp }], e.seenNow ? tick : tick - 1);
  });
  for (const p of w.foodTiles) {
    grid.setResourceYield(p.x, p.y, "food");
    beast.recordTile(p.x, p.y, "plains", [], tick - 10);
  }
  const state: SimulationState = {
    grid, tick, agents, settlements: new Map([["den-1", den]]), activeSessions: new Map(), dialogueTrees: new Map(),
  };
  return { state, beast };
}

describe("beast options (property)", () => {
  it("every offered option yields a frame, rest first, ids unique", () => {
    fc.assert(
      fc.property(world, (w) => {
        const { state, beast } = build(w);
        const options = buildOptions(beast, state, () => w.rand);
        expect(options[0].id).toBe("rest");
        expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
        for (const option of options) {
          expect(nextFrame(beast, { ...option.goal }, state), option.id).not.toBeNull();
        }
      }),
      { numRuns: 1000 },
    );
  });
});
