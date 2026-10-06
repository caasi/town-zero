import { describe, it, expect } from "vitest";
import { processRespawns, NPC_RESPAWN_TICKS, BEAST_BREED_TICKS, BEAST_BREED_FOOD } from "../../src/simulation/respawn.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";

function setup() {
  const village = new Settlement({ id: "village-1", faction: "village-1", type: "village", territory: [{ x: 1, y: 1 }, { x: 2, y: 1 }] });
  const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 8, y: 8 }] });
  const farmer = new Agent({ id: "farmer", position: { x: 5, y: 5 }, faction: "village-1", role: "farmer", controller: "bot" });
  const beast = new Agent({ id: "b1", position: { x: 6, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });
  const player = new Agent({ id: "p1", position: { x: 1, y: 1 }, faction: "village-1", role: "player", controller: "player" });
  const state: SimulationState = {
    grid: new Grid(10, 10), tick: 0,
    agents: new Map([["farmer", farmer], ["b1", beast], ["p1", player]]),
    settlements: new Map([["village-1", village], ["den-1", den]]),
    activeSessions: new Map(), dialogueTrees: new Map(),
  };
  return { state, village, den, farmer, beast, player };
}

function runUntil(state: SimulationState, respawnAt: Map<string, number>, tick: number) {
  while (state.tick < tick) { state.tick++; processRespawns(state, respawnAt); }
}

describe("processRespawns", () => {
  it("brings a dead village NPC back home after the delay, on a free tile", () => {
    const { state, village, farmer } = setup();
    const respawnAt = new Map<string, number>();
    farmer.takeDamage(1000);
    runUntil(state, respawnAt, NPC_RESPAWN_TICKS);
    expect(farmer.isAlive()).toBe(false);
    runUntil(state, respawnAt, NPC_RESPAWN_TICKS + 1);
    expect(farmer.isAlive()).toBe(true);
    expect(farmer.position).toEqual({ x: 2, y: 1 }); // (1,1) holds the player
    expect(village.populationIds).toContain("farmer");
  });

  it("breeds the first beast of an empty den for free", () => {
    const { state, den, beast } = setup();
    const respawnAt = new Map<string, number>();
    beast.takeDamage(1000);
    runUntil(state, respawnAt, BEAST_BREED_TICKS + 1);
    expect(beast.isAlive()).toBe(true);
    expect(den.inventory.food).toBe(0);
  });

  it("breeds a dead beast only when the den pays food", () => {
    const { state, den, beast } = setup();
    const mate = new Agent({ id: "b2", position: { x: 8, y: 8 }, faction: "den-1", role: "beast", controller: "llm" });
    state.agents.set("b2", mate);
    den.populationIds.push("b2"); // a living den-mate: breeding is not free
    const respawnAt = new Map<string, number>();
    beast.takeDamage(1000);
    runUntil(state, respawnAt, BEAST_BREED_TICKS + 5);
    expect(beast.isAlive()).toBe(false); // den has no food

    den.addResource("food", BEAST_BREED_FOOD + 1);
    runUntil(state, respawnAt, state.tick + 1);
    expect(beast.isAlive()).toBe(true);
    expect(den.inventory.food).toBe(1);
    expect(beast.position).toEqual({ x: 8, y: 8 }); // the only tile, taken by b2
  });

  it("leaves dead players to the revive button", () => {
    const { state, player } = setup();
    const respawnAt = new Map<string, number>();
    player.takeDamage(1000);
    runUntil(state, respawnAt, NPC_RESPAWN_TICKS * 2);
    expect(player.isAlive()).toBe(false);
  });
});
