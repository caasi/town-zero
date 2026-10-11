import { DIRECTION_DELTA, RESOURCE_REGROW_TICKS, isMoveBlocked } from "@town-zero/shared";
import type { EntitySnapshot, Facing, InputFrame, Position } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import type { SimulationState } from "../simulation/tick.js";
import { storeFoodKey } from "../simulation/vision.js";
import type { ChooseFn } from "./jev.js";

export type Goal =
  | { kind: "attack"; targetId: string; readyTick?: number }
  | { kind: "eat" }
  | { kind: "forage"; tile: Position }
  | { kind: "store" }
  | { kind: "flee" }
  | { kind: "wander"; to: Position; untilTick: number }
  | { kind: "rest"; untilTick: number }
  | { kind: "roar"; untilTick: number }
  | { kind: "wait"; near: Position; untilTick: number };

export interface Option {
  id: string;
  description: string;
  goal: Goal;
}

const INSTRUCTIONS = "You are this beast. Which plan should it follow next?";
const GUARD_PATROL_RADIUS = 3;
const EXPLORE_RADIUS = 8;
const GUARD_RADIUS = 6;
const CARRY_FULL = 5;
const DEN_FOOD_LOW = 10;
const WANDER_TICKS = 40;
const REST_TICKS = 24;
const ROAR_TICKS = 16;
const WAIT_TICKS = RESOURCE_REGROW_TICKS;
const WAIT_DISTANCE = 2;
const TAKE_FOOD = 3;
const KEEP_FOOD = TAKE_FOOD;
const ATTACK_COOLDOWN_TICKS = 8;
const ASK_INTERVAL_TICKS = 8;
const MOVE_INTERVAL_TICKS = 2;

const distance = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function homeOf(agent: Agent, state: SimulationState): Settlement | undefined {
  return Array.from(state.settlements.values()).find((s) => s.populationIds.includes(agent.id));
}

function homeCenter(home: Settlement): Position {
  return home.structures.find((s) => s.type === "core")?.position ?? home.territory[0];
}

function knownFood(agent: Agent, home: Settlement): number | undefined {
  return agent.getBelief(storeFoodKey(home.id))?.value as number | undefined;
}

function visibleEnemies(agent: Agent, state: SimulationState): EntitySnapshot[] {
  const seen = new Map<string, EntitySnapshot>();
  for (const [, mem] of agent.getAllMemory()) {
    if (mem.timestamp !== state.tick) continue;
    for (const e of mem.entities) if (e.faction !== agent.faction) seen.set(e.id, e);
  }
  return [...seen.values()];
}

function isThreat(agent: Agent, enemy: EntitySnapshot, state: SimulationState): boolean {
  const home = homeOf(agent, state);
  return !home
    || distance(enemy.position, homeCenter(home)) <= GUARD_RADIUS
    || distance(agent.position, enemy.position) <= 1;
}

function nearestKnownFood(agent: Agent, state: SimulationState, usedUp = false): Position | undefined {
  let best: Position | undefined;
  for (const [key, mem] of agent.getAllMemory()) {
    if ((mem.resourceAmount === 0) !== usedUp) continue;
    const [x, y] = key.split(",").map(Number);
    if (state.grid.getResourceYield(x, y) !== "food") continue;
    const d = distance(agent.position, { x, y });
    if (d === 0) continue;
    if (!best || d < distance(agent.position, best)) best = { x, y };
  }
  return best;
}

// external: The options a beast may pick from. Rules that Jev forces:
// - Words, not coordinates: Jev is weak at spatial and numeric reasoning.
// - "rest" goes first: Jev leans toward the first option (jev-1.13 known
//   limitations), so that bias lands on the safest choice.
export function buildOptions(agent: Agent, state: SimulationState, rand = Math.random): Option[] {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
  const around = (c: Position, r: number): Position => ({
    x: clamp(c.x + Math.round((rand() * 2 - 1) * r), state.grid.width),
    y: clamp(c.y + Math.round((rand() * 2 - 1) * r), state.grid.height),
  });
  const options: Option[] = [
    { id: "rest", description: "Stay where you are.", goal: { kind: "rest", untilTick: state.tick + REST_TICKS } },
  ];
  const offer = (id: string, description: string, goal: Goal) => {
    if (nextFrame(agent, { ...goal }, state)) options.push({ id, description, goal });
  };
  const home = homeOf(agent, state);
  const enemies = visibleEnemies(agent, state).filter((e) => isThreat(agent, e, state));
  const food = agent.inventory.food;
  const denFood = home && knownFood(agent, home);
  const foodTile = nearestKnownFood(agent, state);
  if (home) {
    offer("guard_den", "Patrol around the den.",
      { kind: "wander", to: around(homeCenter(home), GUARD_PATROL_RADIUS), untilTick: state.tick + WANDER_TICKS });
  }
  if (foodTile && food < CARRY_FULL) {
    offer("forage", "Go to the nearest place where food grows and gather food.", { kind: "forage", tile: foodTile });
  }
  const emptyTile = nearestKnownFood(agent, state, true);
  if (emptyTile) {
    offer("wait_for_food", "Wait near the empty berry bushes until they grow back.",
      { kind: "wait", near: emptyTile, untilTick: state.tick + WAIT_TICKS });
  }
  if (!foodTile) {
    offer("explore", "Walk away from here to find a place where food grows.",
      { kind: "wander", to: around(home ? homeCenter(home) : agent.position, EXPLORE_RADIUS), untilTick: state.tick + WANDER_TICKS });
  }
  if (home && food >= CARRY_FULL && (denFood ?? 0) < DEN_FOOD_LOW) {
    offer("bring_food_home", "Carry your food back and store it in the den.", { kind: "store" });
  }
  if (home && food === 0 && denFood !== 0) {
    offer("eat_at_den", "Go back to the den and take food.", { kind: "eat" });
  }
  if (home && enemies.length > 0 && !home.isInTerritory(agent.position)) {
    offer("flee_to_den", "Run away from enemies to the den.", { kind: "flee" });
  }
  if (enemies.length > 0) {
    offer("roar", "Roar to warn the enemies away from the den.", { kind: "roar", untilTick: state.tick + ROAR_TICKS });
  }
  for (const enemy of enemies) {
    offer(`attack:${enemy.id}`, `Walk to ${enemy.id} and attack it.`, { kind: "attack", targetId: enemy.id });
  }
  return options;
}

export function describeState(agent: Agent, state: SimulationState): Record<string, unknown> {
  const home = homeOf(agent, state);
  const food = agent.inventory.food;
  const enemies = visibleEnemies(agent, state).map((e) =>
    `${e.id}, an enemy ${e.role}, ${distance(agent.position, e.position)} steps away, HP ${e.hp} of ${e.maxHp}, `
    + (isThreat(agent, e, state) ? "a threat to the den" : "far from the den"));
  const known = home && knownFood(agent, home);
  const denFood = known === undefined
    ? "an unknown amount of food"
    : `${known} food${known < DEN_FOOD_LOW ? " (low)" : ""}`;
  const foodTile = nearestKnownFood(agent, state);
  const emptyTile = nearestKnownFood(agent, state, true);
  return {
    self: `a ${agent.role} of the den. HP ${agent.hp} of ${agent.maxHp}. Carrying ${food} food${food >= CARRY_FULL ? " (full)" : ""}.${food === 0 ? " Hungry." : ""}`,
    home: !home
      ? "no home"
      : home.isInTerritory(agent.position)
        ? `inside the den, which holds ${denFood}`
        : `the den is ${distance(agent.position, homeCenter(home))} steps away and holds ${denFood}`,
    food_places: foodTile
      ? `knows a place where food grows, ${distance(agent.position, foodTile)} steps away`
      : emptyTile
        ? `knows places where food grows, ${distance(agent.position, emptyTile)} steps away, but saw them eaten bare; they grow back in time`
        : "knows no place where food grows",
    visible: enemies.length > 0 ? enemies : "no enemies in sight",
  };
}

export function fallbackGoal(agent: Agent, state: SimulationState): Goal {
  const home = homeOf(agent, state);
  const food = agent.inventory.food;
  const threat = visibleEnemies(agent, state).find((e) => isThreat(agent, e, state));
  const foodTile = nearestKnownFood(agent, state);
  const denFood = home && knownFood(agent, home);
  if (food === 0 && home && denFood !== 0) return { kind: "eat" };
  if (threat) return { kind: "attack", targetId: threat.id };
  if (home && food >= CARRY_FULL && (denFood ?? 0) < DEN_FOOD_LOW) return { kind: "store" };
  if (foodTile && food < CARRY_FULL) return { kind: "forage", tile: foodTile };
  if (home) return { kind: "wander", to: homeCenter(home), untilTick: state.tick + WANDER_TICKS };
  return { kind: "rest", untilTick: state.tick + REST_TICKS };
}

function passable(state: SimulationState, p: Position): boolean {
  return !isMoveBlocked(p.x, p.y, state.grid, state.grid.getTerrain(p.x, p.y));
}

function stepToward(agent: Agent, to: Position, state: SimulationState): Facing | null {
  const dx = Math.sign(to.x - agent.position.x);
  const dy = Math.sign(to.y - agent.position.y);
  const horizontal: Facing | null = dx > 0 ? "east" : dx < 0 ? "west" : null;
  const vertical: Facing | null = dy > 0 ? "south" : dy < 0 ? "north" : null;
  const order = Math.abs(to.x - agent.position.x) >= Math.abs(to.y - agent.position.y)
    ? [horizontal, vertical] : [vertical, horizontal];
  for (const dir of order) {
    if (!dir) continue;
    const d = DIRECTION_DELTA[dir];
    if (passable(state, { x: agent.position.x + d.dx, y: agent.position.y + d.dy })) return dir;
  }
  return null;
}

const move = (direction: Facing): InputFrame => ({ seq: 0, direction });

export function nextFrame(agent: Agent, goal: Goal, state: SimulationState): InputFrame | null {
  switch (goal.kind) {
    case "attack": {
      const target = visibleEnemies(agent, state).find((e) => e.id === goal.targetId);
      if (!target || !isThreat(agent, target, state)) return null;
      if (distance(agent.position, target.position) === 1) {
        const dir = stepToward(agent, target.position, state) ?? agent.facing;
        if (dir !== agent.facing) return move(dir);
        if (state.tick < (goal.readyTick ?? 0)) return { seq: 0, action: { type: "idle" } };
        goal.readyTick = state.tick + ATTACK_COOLDOWN_TICKS;
        return { seq: 0, action: { type: "attack", targetId: target.id } };
      }
      const dir = stepToward(agent, target.position, state);
      return dir ? move(dir) : null;
    }
    case "eat":
    case "flee": {
      const home = homeOf(agent, state);
      if (!home) return null;
      if (!home.isInTerritory(agent.position)) {
        const dir = stepToward(agent, homeCenter(home), state);
        return dir ? move(dir) : null;
      }
      if (goal.kind === "eat" && agent.inventory.food === 0 && home.inventory.food > 0) {
        const amount = Math.min(TAKE_FOOD, home.inventory.food);
        return { seq: 0, action: { type: "take", settlementId: home.id, resource: "food", amount } };
      }
      return null;
    }
    case "forage": {
      if (agent.inventory.food >= CARRY_FULL) return null;
      if (!agent.getMemory(goal.tile.x, goal.tile.y)?.resourceAmount) return null;
      const d = distance(agent.position, goal.tile);
      if (d === 0) return null;
      if (d === 1) {
        const dir = stepToward(agent, goal.tile, state) ?? agent.facing;
        if (dir !== agent.facing) return move(dir);
        return { seq: 0, action: { type: "gather", resourceTile: { ...goal.tile } } };
      }
      const dir = stepToward(agent, goal.tile, state);
      return dir ? move(dir) : null;
    }
    case "store": {
      const home = homeOf(agent, state);
      if (!home || agent.inventory.food <= KEEP_FOOD) return null;
      if (home.isInTerritory(agent.position)) {
        return { seq: 0, action: { type: "deposit", settlementId: home.id, keepFood: KEEP_FOOD } };
      }
      const dir = stepToward(agent, homeCenter(home), state);
      return dir ? move(dir) : null;
    }
    case "wander": {
      if (state.tick >= goal.untilTick) return null;
      if (distance(agent.position, goal.to) === 0) {
        const threat = visibleEnemies(agent, state).some((e) => isThreat(agent, e, state));
        return threat ? null : { seq: 0, action: { type: "idle" } };
      }
      const dir = stepToward(agent, goal.to, state);
      return dir ? move(dir) : null;
    }
    case "wait": {
      if (state.tick >= goal.untilTick) return null;
      if (nearestKnownFood(agent, state)) return null;
      if (visibleEnemies(agent, state).some((e) => isThreat(agent, e, state))) return null;
      if (distance(agent.position, goal.near) <= WAIT_DISTANCE) return { seq: 0, action: { type: "idle" } };
      const dir = stepToward(agent, goal.near, state);
      return dir ? move(dir) : null;
    }
    case "rest":
    case "roar":
      return state.tick >= goal.untilTick ? null : { seq: 0, action: { type: "idle" } };
  }
}

export class JevController {
  private goals = new Map<string, Goal>();
  private pending = new Set<string>();
  private lastAskTick = new Map<string, number>();
  private nextMoveTick = new Map<string, number>();

  constructor(private choose: ChooseFn | null, private rand = Math.random) {}

  update(state: SimulationState): void {
    for (const agent of state.agents.values()) {
      if (agent.controller !== "llm") continue;
      if (!agent.isAlive()) { this.goals.delete(agent.id); continue; }
      if (agent.planBacklog.length > 0) continue;

      const goal = this.goals.get(agent.id);
      const frame = goal && nextFrame(agent, goal, state);
      if (frame) {
        if (frame.direction) {
          if (state.tick < (this.nextMoveTick.get(agent.id) ?? 0)) continue;
          this.nextMoveTick.set(agent.id, state.tick + MOVE_INTERVAL_TICKS);
        }
        agent.planBacklog = [frame];
        continue;
      }
      this.goals.delete(agent.id);
      this.decide(agent, state);
    }
  }

  getGoal(agentId: string): Goal | undefined {
    return this.goals.get(agentId);
  }

  private decide(agent: Agent, state: SimulationState): void {
    if (!this.choose) {
      this.goals.set(agent.id, fallbackGoal(agent, state));
      return;
    }
    if (this.pending.has(agent.id)) return;
    const last = this.lastAskTick.get(agent.id);
    if (last !== undefined && state.tick - last < ASK_INTERVAL_TICKS) return;
    this.pending.add(agent.id);
    this.lastAskTick.set(agent.id, state.tick);

    const askedTick = state.tick;
    const home = homeOf(agent, state);
    const denFood = home ? knownFood(agent, home) ?? "unknown" : "none";
    const context = ` at (${agent.position.x},${agent.position.y}), carrying ${agent.inventory.food}, den food ${denFood}`;
    const options = buildOptions(agent, state, this.rand);
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.description]));
    this.choose(describeState(agent, state), INSTRUCTIONS, criteria)
      .then(({ id, usage }) => {
        const cost = usage ? ` (in ${usage.input}, out ${usage.output})` : "";
        console.log(`[jev] ${agent.id} chose ${id} from ${Object.keys(criteria).join(", ")}${cost}${context}`);
        if (!agent.isAlive()) return;
        const goal = options.find((o) => o.id === id)!.goal;
        if ("untilTick" in goal) goal.untilTick += state.tick - askedTick;
        if (goal.kind === "roar") agent.setBubble("ROAR!", goal.untilTick - state.tick, state.tick);
        this.goals.set(agent.id, goal);
      })
      .catch((err) => {
        console.error(`[jev] decision failed for ${agent.id}:`, err);
        if (!agent.isAlive()) return;
        this.goals.set(agent.id, fallbackGoal(agent, state));
      })
      .finally(() => this.pending.delete(agent.id));
  }
}
