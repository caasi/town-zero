import { describe, it, expect, vi } from "vitest";
import { JevController, buildOptions, nextFrame, describeState, type Goal } from "../../src/ai/jev-controller.js";
import { jevChooser, type Choice } from "../../src/ai/jev.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import { updateStoreKnowledge } from "../../src/simulation/vision.js";
import { RESOURCE_REGROW_TICKS } from "@town-zero/shared";

// Den around (2,2); beast inside it; player p1 to the east.
function setup() {
  const grid = new Grid(20, 20);
  const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 2, y: 2 }, { x: 3, y: 2 }] });
  den.addStructure({ id: "core", type: "core", position: { x: 2, y: 2 } });
  den.addResource("food", 10);
  const beast = new Agent({ id: "b1", position: { x: 2, y: 2 }, faction: "den-1", role: "beast", controller: "llm" });
  den.populationIds.push("b1");
  const player = new Agent({ id: "p1", position: { x: 6, y: 2 }, faction: "village-1", role: "player", controller: "player" });
  const state: SimulationState = {
    grid, tick: 10,
    agents: new Map([["b1", beast], ["p1", player]]),
    settlements: new Map([["den-1", den]]),
    activeSessions: new Map(), dialogueTrees: new Map(),
  };
  const know = () => updateStoreKnowledge(beast, state.settlements, state.tick);
  know(); // the beast was home at the last vision step
  return { state, beast, player, den, know };
}

function see(beast: Agent, other: Agent, tick: number) {
  beast.recordTile(other.position.x, other.position.y, "plains",
    [{ id: other.id, type: "agent", faction: other.faction, position: { ...other.position }, role: other.role, hp: other.hp, maxHp: other.maxHp }], tick, 0);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("buildOptions", () => {
  it("offers attack only for enemies seen this tick", () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    expect(buildOptions(beast, state).map((o) => o.id)).toContain("attack:p1");

    see(beast, player, state.tick - 1); // remembered, not seen now
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("attack:p1");
  });

  it("offers only options that make sense now, rest first", () => {
    const { state, beast, player, know } = setup();
    // Hungry, at home, no enemy in sight, no food place known.
    expect(buildOptions(beast, state, () => 0.9).map((o) => o.id)).toEqual(["rest", "guard_den", "explore", "eat_at_den"]);

    // Full load, outside the den, enemy near the den in sight, den food low.
    beast.addToInventory("food", 5);
    state.settlements.get("den-1")!.inventory.food = 5;
    know();
    beast.position = { x: 5, y: 2 };
    see(beast, player, state.tick);
    expect(buildOptions(beast, state, () => 0.9).map((o) => o.id))
      .toEqual(["rest", "guard_den", "explore", "bring_food_home", "flee_to_den", "roar", "attack:p1"]);
  });

  it("offers explore and guard_den only when the first step is possible", () => {
    const { state, beast } = setup();
    // Walled in by water: no step in any direction (rand 0.9: the target is not its own tile).
    for (const [x, y] of [[3, 2], [1, 2], [2, 3], [2, 1]]) state.grid.setTerrain(x, y, "water");
    const ids = buildOptions(beast, state, () => 0.9).map((o) => o.id);
    expect(ids).not.toContain("explore");
    expect(ids).not.toContain("guard_den");
  });

  it("every offered walk yields a frame for any rand value", () => {
    const { state, beast } = setup();
    beast.position = { x: 0, y: 0 }; // corner: many targets are out of bounds
    let offered = 0;
    for (let i = 0; i < 100; i++) {
      const r = i / 100;
      for (const option of buildOptions(beast, state, () => r)) {
        if (option.id !== "explore" && option.id !== "guard_den") continue;
        offered++;
        expect(nextFrame(beast, option.goal, state), `${option.id} rand=${r}`).not.toBeNull();
      }
    }
    expect(offered).toBeGreaterThan(0);
  });

  it("does not offer an attack on an enemy far from the den", () => {
    const { state, beast, player } = setup();
    player.position = { x: 15, y: 2 }; // 13 steps from the den core
    beast.position = { x: 12, y: 2 };
    see(beast, player, state.tick);
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("attack:p1");

    player.position = { x: 13, y: 2 }; // next to the beast: self-defence
    see(beast, player, state.tick);
    expect(buildOptions(beast, state).map((o) => o.id)).toContain("attack:p1");
  });

  it("does not offer to store food just taken at the den", () => {
    const { state, beast, den, know } = setup();
    den.inventory.food = 5; // low
    know();
    beast.addToInventory("food", 3); // what eat_at_den takes
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("bring_food_home");
  });

  it("offers forage only for a food place the beast remembers", () => {
    const { state, beast } = setup();
    state.grid.setResourceYield(8, 2, "food");
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("forage");
    beast.recordTile(8, 2, "plains", [], state.tick - 50, 3); // seen long ago still counts
    const ids = buildOptions(beast, state).map((o) => o.id);
    expect(ids).toContain("forage");
    expect(ids).not.toContain("explore");
    beast.addToInventory("food", 5); // full
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("forage");
  });

  it("does not offer forage for a food place it saw used up", () => {
    const { state, beast } = setup();
    state.grid.setResourceYield(8, 2, "food"); // full now, but the beast saw it empty
    beast.recordTile(8, 2, "plains", [], state.tick - 50, 0);
    const ids = buildOptions(beast, state).map((o) => o.id);
    expect(ids).not.toContain("forage");
    expect(ids).toContain("explore");
  });

  it("every offered option yields a frame (no instant re-ask loop)", () => {
    const { state, beast, player, know } = setup();
    state.grid.setResourceYield(8, 2, "food");
    beast.recordTile(8, 2, "plains", [], state.tick, 3);
    state.settlements.get("den-1")!.inventory.food = 5; // low: bring_food_home is offered
    know();
    for (const food of [0, 3, 5]) {
      for (const pos of [{ x: 2, y: 2 }, { x: 5, y: 2 }]) {
        beast.inventory.food = food;
        beast.position = pos;
        see(beast, player, state.tick);
        for (const option of buildOptions(beast, state, () => 0.9)) {
          expect(nextFrame(beast, option.goal, state), `${option.id} food=${food} at ${pos.x}`).not.toBeNull();
        }
      }
    }
  });

  it("offers no option whose first step is blocked", () => {
    const { state, beast, player } = setup();
    // Beast outside the den, enemy next to the den; water on every side of the beast.
    beast.position = { x: 6, y: 6 };
    player.position = { x: 4, y: 2 };
    see(beast, player, state.tick);
    for (const [x, y] of [[7, 6], [5, 6], [6, 7], [6, 5]]) state.grid.setTerrain(x, y, "water");
    for (const option of buildOptions(beast, state, () => 0.9)) {
      expect(nextFrame(beast, option.goal, state), option.id).not.toBeNull();
    }
  });

  it("describes state in words, without coordinates", () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    const desc = describeState(beast, state);
    expect(desc.visible).toEqual(["p1, an enemy player, 4 steps away, HP 100 of 100, a threat to the den"]);
    expect(desc.home).toBe("inside the den, which holds 10 food");
    expect(desc.food_places).toBe("knows no place where food grows");
    expect(desc.self).toContain("Hungry.");
  });
});

describe("what the beast knows", () => {
  it("reads the den food from its memory, not from the live store", () => {
    const { state, beast, den } = setup(); // saw 10 food at home
    beast.position = { x: 6, y: 6 };
    den.inventory.food = 2;
    expect(describeState(beast, state).home).toBe("the den is 8 steps away and holds 10 food");
  });

  it("says so when it never saw the den store", () => {
    const { state } = setup();
    const fresh = new Agent({ id: "b2", position: { x: 6, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });
    state.settlements.get("den-1")!.populationIds.push("b2");
    state.agents.set("b2", fresh);
    expect(describeState(fresh, state).home).toBe("the den is 8 steps away and holds an unknown amount of food");
    // A hungry beast that does not know goes home to look.
    expect(buildOptions(fresh, state).map((o) => o.id)).toContain("eat_at_den");
  });

  it("offers food at the den only when it believes there is some", () => {
    const { state, beast, den, know } = setup();
    beast.position = { x: 6, y: 6 };
    den.inventory.food = 0; // gone since the beast left: it does not know
    expect(buildOptions(beast, state).map((o) => o.id)).toContain("eat_at_den");

    beast.position = { x: 2, y: 2 };
    know(); // home again: it sees the empty store
    beast.position = { x: 6, y: 6 };
    den.inventory.food = 10; // refilled since: it does not know
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("eat_at_den");
  });

  it("offers to bring food home only when it believes the den is low", () => {
    const { state, beast, den } = setup(); // saw 10 food: not low
    beast.position = { x: 6, y: 6 };
    beast.addToInventory("food", 5);
    den.inventory.food = 1;
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("bring_food_home");
  });

  it("says when the beast carries a full load", () => {
    // Without "(full)", real Jev calls picked explore 10 of 10 times for a
    // beast with 5 food; with it, guard_den 9 of 10 (spike, 2026-10-07).
    const { state, beast } = setup();
    beast.addToInventory("food", 5);
    expect(describeState(beast, state).self).toBe("a beast of the den. HP 100 of 100. Carrying 5 food (full).");
    beast.inventory.food = 4;
    expect(describeState(beast, state).self).toBe("a beast of the den. HP 100 of 100. Carrying 4 food.");
  });

  it("describes an enemy by what it saw, not by the live agent", () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    player.hp = 10;
    player.position = { x: 15, y: 15 };
    expect(describeState(beast, state).visible).toEqual(["p1, an enemy player, 4 steps away, HP 100 of 100, a threat to the den"]);
  });
});

describe("wait_for_food", () => {
  // Beast at the den core (2,2); a berry place at (8,2) that it saw used up.
  function emptyBush() {
    const s = setup();
    s.state.grid.setResourceYield(8, 2, "food");
    s.beast.recordTile(8, 2, "plains", [], s.state.tick, 0);
    return s;
  }

  it("the state says the beast knows the used-up places, so it matches the option", () => {
    const { state, beast } = emptyBush();
    expect(describeState(beast, state).food_places)
      .toBe("knows places where food grows, 6 steps away, but saw them eaten bare; they grow back in time");
  });

  it("is offered only when the beast remembers a used-up food place", () => {
    const { state, beast } = setup();
    expect(buildOptions(beast, state).map((o) => o.id)).not.toContain("wait_for_food");
    const s = emptyBush();
    expect(buildOptions(s.beast, s.state).map((o) => o.id)).toContain("wait_for_food");
  });

  it("walks near the place, then waits there", () => {
    const { state, beast } = emptyBush();
    const goal = buildOptions(beast, state).find((o) => o.id === "wait_for_food")!.goal;
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, direction: "east" });
    beast.position = { x: 6, y: 2 }; // 2 steps away: close enough
    expect(nextFrame(beast, goal, state)?.action).toEqual({ type: "idle" });
  });

  it("waits one regrowth interval at most", () => {
    const { state, beast } = emptyBush();
    const goal = buildOptions(beast, state).find((o) => o.id === "wait_for_food")!.goal;
    beast.position = { x: 6, y: 2 };
    state.tick += RESOURCE_REGROW_TICKS - 1;
    expect(nextFrame(beast, goal, state)).not.toBeNull();
    state.tick += 1;
    expect(nextFrame(beast, goal, state)).toBeNull();
  });

  it("ends when the beast sees food grow back, so it can forage", () => {
    const { state, beast } = emptyBush();
    const goal = buildOptions(beast, state).find((o) => o.id === "wait_for_food")!.goal;
    beast.position = { x: 6, y: 2 };
    beast.recordTile(8, 2, "plains", [], state.tick + 1, 1);
    expect(nextFrame(beast, goal, state)).toBeNull();
    expect(buildOptions(beast, state).map((o) => o.id)).toContain("forage");
  });

  it("ends when a threat comes into sight", () => {
    const { state, beast, player } = emptyBush();
    const goal = buildOptions(beast, state).find((o) => o.id === "wait_for_food")!.goal;
    beast.position = { x: 6, y: 2 };
    player.position = { x: 5, y: 2 }; // next to the beast
    see(beast, player, state.tick);
    expect(nextFrame(beast, goal, state)).toBeNull();
  });
});

describe("nextFrame", () => {
  it("attack: walks toward, turns to face, then attacks", () => {
    const { state, beast, player } = setup();
    const goal: Goal = { kind: "attack", targetId: "p1" };
    see(beast, player, state.tick);
    beast.facing = "east";
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, direction: "east" });

    player.position = { x: 2, y: 3 }; // adjacent, south of the beast
    see(beast, player, state.tick);
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, direction: "south" });

    beast.facing = "south";
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, action: { type: "attack", targetId: "p1" } });
    // Cooldown: idles until ~1s later, then attacks again.
    state.tick += 1;
    see(beast, player, state.tick);
    expect(nextFrame(beast, goal, state)?.action).toEqual({ type: "idle" });
    state.tick += 7;
    see(beast, player, state.tick);
    expect(nextFrame(beast, goal, state)?.action).toEqual({ type: "attack", targetId: "p1" });

    // The next vision step does not record a dead agent, so the goal ends.
    player.takeDamage(1000);
    state.tick += 1;
    expect(nextFrame(beast, goal, state)).toBeNull();
  });

  it("attack: ends when the target leaves the den area", () => {
    const { state, beast, player } = setup();
    beast.position = { x: 7, y: 2 };
    player.position = { x: 10, y: 2 }; // 8 steps from the den core, 3 from the beast
    see(beast, player, state.tick);
    expect(nextFrame(beast, { kind: "attack", targetId: "p1" }, state)).toBeNull();
  });

  it("forage: walks to the food place, faces it, gathers until full", () => {
    const { state, beast } = setup();
    const goal: Goal = { kind: "forage", tile: { x: 5, y: 2 } };
    beast.recordTile(5, 2, "plains", [], state.tick, 3);
    beast.facing = "east";
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, direction: "east" });
    beast.position = { x: 5, y: 3 }; // adjacent, food is to the north
    expect(nextFrame(beast, goal, state)).toEqual({ seq: 0, direction: "north" });
    beast.position = { x: 4, y: 2 };
    expect(nextFrame(beast, goal, state)?.action).toEqual({ type: "gather", resourceTile: { x: 5, y: 2 } });
    beast.addToInventory("food", 5);
    expect(nextFrame(beast, goal, state)).toBeNull();
  });

  it("forage: ends when the beast sees the food place used up", () => {
    const { state, beast } = setup();
    const goal: Goal = { kind: "forage", tile: { x: 5, y: 2 } };
    beast.recordTile(5, 2, "plains", [], state.tick, 1);
    expect(nextFrame(beast, goal, state)).not.toBeNull();
    beast.recordTile(5, 2, "plains", [], state.tick + 1, 0);
    expect(nextFrame(beast, goal, state)).toBeNull();
  });

  it("store: walks home and deposits what it does not eat itself, then is done", () => {
    const { state, beast } = setup();
    beast.addToInventory("food", 5);
    beast.position = { x: 6, y: 2 };
    expect(nextFrame(beast, { kind: "store" }, state)).toEqual({ seq: 0, direction: "west" });
    beast.position = { x: 3, y: 2 };
    expect(nextFrame(beast, { kind: "store" }, state)?.action).toEqual({ type: "deposit", settlementId: "den-1", keepFood: 3 });
    beast.inventory.food = 3; // what the deposit leaves
    expect(nextFrame(beast, { kind: "store" }, state)).toBeNull();
  });

  it("after bringing food home, a beast is not offered to take food back", () => {
    const { state, beast, den, know } = setup();
    den.inventory.food = 5;
    know(); // low
    beast.inventory.food = 3; // what a deposit leaves
    const ids = buildOptions(beast, state).map((o) => o.id);
    expect(ids).not.toContain("eat_at_den");
    expect(ids).not.toContain("bring_food_home");
  });

  it("attack: ends when the target is out of sight", () => {
    const { state, beast } = setup();
    expect(nextFrame(beast, { kind: "attack", targetId: "p1" }, state)).toBeNull();
  });

  it("eat: walks home, takes food, then is done", () => {
    const { state, beast } = setup();
    beast.position = { x: 5, y: 2 };
    expect(nextFrame(beast, { kind: "eat" }, state)).toEqual({ seq: 0, direction: "west" });

    beast.position = { x: 3, y: 2 };
    expect(nextFrame(beast, { kind: "eat" }, state)?.action).toEqual(
      { type: "take", settlementId: "den-1", resource: "food", amount: 3 });

    beast.addToInventory("food", 3);
    expect(nextFrame(beast, { kind: "eat" }, state)).toBeNull();
  });

  it("steps around impassable terrain on the other axis", () => {
    const { state, beast } = setup();
    state.grid.setTerrain(3, 2, "water");
    expect(nextFrame(beast, { kind: "wander", to: { x: 6, y: 4 }, untilTick: 99 }, state))
      .toEqual({ seq: 0, direction: "south" });
  });

  it("wander: holds the spot after arrival until its tick", () => {
    const { state, beast } = setup();
    const goal: Goal = { kind: "wander", to: { x: 2, y: 2 }, untilTick: 12 };
    expect(nextFrame(beast, goal, state)?.action).toEqual({ type: "idle" });
    state.tick = 12;
    expect(nextFrame(beast, goal, state)).toBeNull();
  });

  it("wander: a threat in sight ends the hold", () => {
    const { state, beast, player } = setup();
    player.position = { x: 4, y: 2 };
    see(beast, player, state.tick);
    expect(nextFrame(beast, { kind: "wander", to: { x: 2, y: 2 }, untilTick: 99 }, state)).toBeNull();
  });

  it("rest: idles until its tick", () => {
    const { state, beast } = setup();
    expect(nextFrame(beast, { kind: "rest", untilTick: 11 }, state)?.action).toEqual({ type: "idle" });
    state.tick = 11;
    expect(nextFrame(beast, { kind: "rest", untilTick: 11 }, state)).toBeNull();
  });
});

// The [jev] line that one decision writes.
async function jevLogLine(state: SimulationState, choice: Choice): Promise<string | undefined> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    new JevController(vi.fn().mockResolvedValue(choice)).update(state);
    await flush();
    return log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[jev]"));
  } finally {
    log.mockRestore();
  }
}

describe("JevController", () => {
  it("logs each decision with its token usage", async () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    expect(await jevLogLine(state, { id: "rest", usage: { input: 424, output: 41 } }))
      .toMatch(/^\[jev\] b1 chose rest from rest, .* \(in 424, out 41\) at \(2,2\), carrying 0, den food 10$/);
  });

  it("logs where the beast was and what it believed when it asked", async () => {
    const { state, beast, den } = setup(); // saw 10 food at home
    beast.position = { x: 6, y: 6 };
    den.inventory.food = 0; // the beast does not know
    beast.addToInventory("food", 2);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      new JevController(vi.fn().mockResolvedValue({ id: "rest" })).update(state);
      beast.position = { x: 9, y: 9 }; // changes after the question are not in the line
      beast.addToInventory("food", 1);
      await flush();
      const line = log.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("[jev]"));
      expect(line).toMatch(/ at \(6,6\), carrying 2, den food 10$/);
    } finally {
      log.mockRestore();
    }
  });

  it("logs an unknown den food when the beast never saw it", async () => {
    const { state } = setup();
    const fresh = new Agent({ id: "b2", position: { x: 6, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });
    state.settlements.get("den-1")!.populationIds = ["b2"];
    state.agents = new Map([["b2", fresh]]);
    expect(await jevLogLine(state, { id: "rest" })).toMatch(/den food unknown$/);
  });

  it("logs a decision without token counts when the reply has none", async () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    const line = await jevLogLine(state, { id: "rest" });
    expect(line).toMatch(/^\[jev\] b1 chose rest from /);
    expect(line).not.toMatch(/\(in /);
  });

  it("asks once, then turns the chosen goal into frames", async () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    const choose = vi.fn().mockResolvedValue({ id: "attack:p1" });
    const controller = new JevController(choose);

    controller.update(state);
    controller.update(state); // still waiting: no second call
    expect(choose).toHaveBeenCalledTimes(1);
    const [, , criteria] = choose.mock.calls[0];
    expect(Object.keys(criteria)).toContain("attack:p1");

    await flush();
    expect(controller.getGoal("b1")).toEqual({ kind: "attack", targetId: "p1" });
    controller.update(state);
    expect(beast.planBacklog).toEqual([{ seq: 0, direction: "east" }]);
  });

  it("asks Jev at most once per 8 ticks per agent, even when goals end at once", async () => {
    const { state, beast, player } = setup();
    // Two enemies, one alive at a time. The picked target dies as Jev answers
    // and the other comes back, so every goal ends at once while an attack is
    // always on offer (buildOptions offers only goals with a first frame).
    const p2 = new Agent({ id: "p2", position: { x: 5, y: 3 }, faction: "village-1", role: "player", controller: "player" });
    state.agents.set("p2", p2);
    p2.takeDamage(1000);
    const choose = vi.fn(async (_s: unknown, _i: string, criteria: Record<string, string>) => {
      const [target, other] = "attack:p1" in criteria ? [player, p2] : [p2, player];
      target.takeDamage(1000);
      other.revive(other.position);
      return { id: `attack:${target.id}` };
    });
    const controller = new JevController(choose);
    for (let i = 0; i < 16; i++) {
      for (const p of [player, p2]) if (p.isAlive()) see(beast, p, state.tick);
      controller.update(state);
      await flush();
      state.tick++;
    }
    expect(choose).toHaveBeenCalledTimes(2); // ticks 10 and 18
  });

  it("starts goal deadlines when the reply arrives, not when it was asked", async () => {
    const { state, beast } = setup();
    let answer!: (id: string) => void;
    const controller = new JevController(() => new Promise((r) => (answer = (id) => r({ id }))));
    controller.update(state);
    state.tick += 30; // slow reply: longer than a rest goal (24 ticks)
    answer("rest");
    await flush();
    expect(nextFrame(beast, controller.getGoal("b1")!, state)?.action).toEqual({ type: "idle" });
  });

  it("roar: Jev's pick shows a bubble while the beast stands still", async () => {
    const { state, beast, player } = setup();
    beast.addToInventory("food", 3);
    see(beast, player, state.tick);
    const controller = new JevController(vi.fn().mockResolvedValue({ id: "roar" }));
    controller.update(state);
    await flush();
    expect(beast.bubbleText).toBe("ROAR!");
    expect(beast.bubbleExpiresAt).toBe(state.tick + 16);
    expect(nextFrame(beast, controller.getGoal("b1")!, state)?.action).toEqual({ type: "idle" });
  });

  it("drops a reply that arrives after the beast died", async () => {
    const { state, beast, player } = setup();
    see(beast, player, state.tick);
    let answer!: (id: string) => void;
    const controller = new JevController(() => new Promise((r) => (answer = (id) => r({ id }))));
    controller.update(state);
    beast.takeDamage(1000);
    answer("roar");
    await flush();
    expect(controller.getGoal("b1")).toBeUndefined();
    expect(beast.bubbleText).toBeNull();
  });

  it("drops the fallback when a failed call ends after the beast died", async () => {
    const { state, beast } = setup();
    let fail!: (err: Error) => void;
    const controller = new JevController(() => new Promise((_, reject) => (fail = reject)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    controller.update(state);
    beast.takeDamage(1000);
    fail(new Error("timeout"));
    await flush();
    expect(controller.getGoal("b1")).toBeUndefined();
  });

  it("forgets the goal of a dead beast, so a respawn asks again", () => {
    const { state, beast } = setup();
    const controller = new JevController(null);
    controller.update(state);
    expect(controller.getGoal("b1")).toBeDefined();
    beast.takeDamage(1000);
    controller.update(state);
    expect(controller.getGoal("b1")).toBeUndefined();
  });

  it("moves a beast at most one step per 2 ticks", async () => {
    const { state, beast } = setup();
    beast.addToInventory("food", 3); // fed: no eat option
    const controller = new JevController(vi.fn().mockResolvedValue({ id: "explore" }), () => 0.99);
    controller.update(state); // asks Jev
    await flush();
    let moves = 0;
    for (let i = 0; i < 8; i++) {
      state.tick++;
      controller.update(state);
      if (beast.planBacklog[0]?.direction) moves++;
      beast.planBacklog = []; // the tick consumes the frame
    }
    expect(moves).toBe(4);
  });

  it("falls back to waiting at the den core when there is nothing to do", () => {
    const { state, beast } = setup();
    beast.addToInventory("food", 5); // full, den not low, no threat
    beast.position = { x: 6, y: 6 };
    const controller = new JevController(null);
    controller.update(state);
    expect(controller.getGoal("b1")).toMatchObject({ kind: "wander", to: { x: 2, y: 2 } });
  });

  it("falls back to a rule when the call fails", async () => {
    const { state } = setup();
    const controller = new JevController(vi.fn().mockRejectedValue(new Error("down")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    controller.update(state);
    await flush();
    expect(controller.getGoal("b1")).toEqual({ kind: "eat" }); // hungry beast with a den
  });

  it("uses the fallback rule when no chooser is configured", () => {
    const { state, beast } = setup();
    beast.addToInventory("food", 2);
    const controller = new JevController(null);
    controller.update(state);
    expect(controller.getGoal("b1")?.kind).toBe("wander"); // waits at the den core
  });

  it("ignores agents that are not llm-controlled", () => {
    const { state, beast } = setup();
    beast.controller = "bot";
    const choose = vi.fn();
    new JevController(choose).update(state);
    expect(choose).not.toHaveBeenCalled();
  });
});

describe("jevChooser", () => {
  const options = { a: "Option A.", b: "Option B." };
  const reply = (body: unknown, ok = true) =>
    vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body });

  it("sends a choice question and returns the chosen id with the token usage", async () => {
    const fetchFn = reply({
      answers: { next: { choice: "b", confidence: 0.9 } },
      usage: { input_tokens: 296, output_tokens: 20 },
    });
    expect(await jevChooser("k", fetchFn)({ s: 1 }, "Pick.", options))
      .toEqual({ id: "b", usage: { input: 296, output: 20 } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body).questions.next).toEqual({ type: "choice", instructions: "Pick.", criteria: options });
  });

  it("leaves out a usage that is not two integers", async () => {
    for (const usage of [{ input_tokens: "many", output_tokens: 1 }, { input_tokens: NaN, output_tokens: 1 }, { input_tokens: 1.5, output_tokens: 1 }]) {
      const fetchFn = reply({ answers: { next: { choice: "a" } }, usage });
      expect(await jevChooser("k", fetchFn)({}, "Pick.", options)).toEqual({ id: "a" });
    }
  });

  it("rejects an id that was not offered", async () => {
    await expect(jevChooser("k", reply({ answers: { next: { choice: "c" } } }))({}, "Pick.", options))
      .rejects.toThrow("unknown choice");
  });

  it("rejects inherited property names as a choice", async () => {
    for (const choice of ["toString", "constructor", "__proto__"]) {
      await expect(jevChooser("k", reply({ answers: { next: { choice } } }))({}, "Pick.", options))
        .rejects.toThrow("unknown choice");
    }
  });

  it("rejects an HTTP error", async () => {
    await expect(jevChooser("k", reply({}, false))({}, "Pick.", options)).rejects.toThrow("HTTP 500");
  });
});
