import { DIRECTION_DELTA, isMoveBlocked } from "@town-zero/shared";
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
  | { kind: "roar"; untilTick: number };

export interface Option {
  id: string;
  description: string;
  goal: Goal;
}

const INSTRUCTIONS = "You are this beast. Which plan should it follow next?";
const GUARD_PATROL_RADIUS = 3; // guard_den walks within this many steps of the den core
const EXPLORE_RADIUS = 8; // around the den core, not the beast: repeated walks must not drift to the village
// Enemies farther than this from the den core are not a threat to the den:
// beasts do not hunt them, and drop a chase when the target leaves this area.
const GUARD_RADIUS = 6;
const CARRY_FULL = 5;     // forage stops at this much food
const DEN_FOOD_LOW = 10;  // below this, a beast with a full load is offered to bring it home
const WANDER_TICKS = 40; // ~5s
const REST_TICKS = 24;   // ~3s
const ROAR_TICKS = 16;   // ~2s: the bubble shows and the beast stands still
const TAKE_FOOD = 3;
// One attack per frame would be 8 hits/s; three beasts killed a player in under 1 s.
const ATTACK_COOLDOWN_TICKS = 8; // ~1 attack/s
// Backstop for the "every option yields a frame" rule: a goal that ends at
// once (blocked path, bad option) must not turn into a paid call every tick.
const ASK_INTERVAL_TICKS = 8; // ~1 Jev call/s per agent at most
// Players move one step per tick at most and lose a tick to turn; beasts at
// the same pace could not be outrun. One step (or turn) per 2 ticks: ~4 tiles/s.
const MOVE_INTERVAL_TICKS = 2;

const distance = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function homeOf(agent: Agent, state: SimulationState): Settlement | undefined {
  return Array.from(state.settlements.values()).find((s) => s.populationIds.includes(agent.id));
}

function homeCenter(home: Settlement): Position {
  return home.structures.find((s) => s.type === "core")?.position ?? home.territory[0];
}

/** The den food count at the last visit (or from a den-mate); undefined if never seen. */
function knownFood(agent: Agent, home: Settlement): number | undefined {
  return agent.getBelief(storeFoodKey(home.id))?.value as number | undefined;
}

/**
 * Enemies this agent saw this tick, as it saw them, read from its own
 * MapMemory (no global knowledge). That memory includes what adjacent
 * den-mates saw this tick, because mergeAdjacentMemories copies tiles with
 * their timestamp.
 */
function visibleEnemies(agent: Agent, state: SimulationState): EntitySnapshot[] {
  const seen = new Map<string, EntitySnapshot>();
  for (const [, mem] of agent.getAllMemory()) {
    if (mem.timestamp !== state.tick) continue;
    for (const e of mem.entities) if (e.faction !== agent.faction) seen.set(e.id, e);
  }
  return [...seen.values()];
}

/**
 * A threat is an enemy near the den, or one close enough to hit this beast.
 * Only threats are offered as targets, so beasts guard home instead of hunting.
 */
function isThreat(agent: Agent, enemy: EntitySnapshot, state: SimulationState): boolean {
  const home = homeOf(agent, state);
  return !home
    || distance(enemy.position, homeCenter(home)) <= GUARD_RADIUS
    || distance(agent.position, enemy.position) <= 1;
}

// ponytail: the yield of a tile never changes, so a tile in MapMemory plus the
// grid's yield is what the agent knows. Store the yield in TileMemory once
// tiles can run out.
function nearestKnownFood(agent: Agent, state: SimulationState): Position | undefined {
  let best: Position | undefined;
  for (const key of agent.getAllMemory().keys()) {
    const [x, y] = key.split(",").map(Number);
    if (state.grid.getResourceYield(x, y) !== "food") continue;
    const d = distance(agent.position, { x, y });
    // Gather needs the tile in front: the beast cannot use the tile it stands on.
    if (d === 0) continue;
    if (!best || d < distance(agent.position, best)) best = { x, y };
  }
  return best;
}

/**
 * The options a beast may pick from. Rules:
 * - Offer only what makes sense now, and every option must yield at least one
 *   frame. An option that is done at once makes the agent ask again at once,
 *   which loops on the API.
 * - Words, not coordinates: Jev is weak at spatial and numeric reasoning.
 * - "rest" goes first: Jev leans toward the first option (jev-1.13 known
 *   limitations), so that bias lands on the safest choice.
 */
export function buildOptions(agent: Agent, state: SimulationState, rand = Math.random): Option[] {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max - 1);
  const around = (c: Position, r: number): Position => ({
    x: clamp(c.x + Math.round((rand() * 2 - 1) * r), state.grid.width),
    y: clamp(c.y + Math.round((rand() * 2 - 1) * r), state.grid.height),
  });
  const options: Option[] = [
    { id: "rest", description: "Stay where you are.", goal: { kind: "rest", untilTick: state.tick + REST_TICKS } },
  ];
  // Only options whose first frame exists: see the rule above. A copy, as
  // nextFrame starts the attack cooldown on the goal it is given.
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
  if (!foodTile) {
    offer("explore", "Walk away from here to find a place where food grows.",
      { kind: "wander", to: around(home ? homeCenter(home) : agent.position, EXPLORE_RADIUS), untilTick: state.tick + WANDER_TICKS });
  }
  // Only a full load: food taken at the den (TAKE_FOOD < CARRY_FULL) is not
  // stored back, or take and deposit alternate and each turn is a paid call.
  // Not knowing the den food counts as low or as some: the beast goes to look.
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

/** Short, decision-relevant state: accuracy drops as unrelated content grows. */
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
  return {
    self: `a ${agent.role} of the den. HP ${agent.hp} of ${agent.maxHp}. Carrying ${food} food.${food === 0 ? " Hungry." : ""}`,
    home: !home
      ? "no home"
      : home.isInTerritory(agent.position)
        ? `inside the den, which holds ${denFood}`
        : `the den is ${distance(agent.position, homeCenter(home))} steps away and holds ${denFood}`,
    food_places: foodTile
      ? `knows a place where food grows, ${distance(agent.position, foodTile)} steps away`
      : "knows no place where food grows",
    visible: enemies.length > 0 ? enemies : "no enemies in sight",
  };
}

/** Used when no Jev key is set or a call fails, so the game still runs. */
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
  // Idle beasts wait at the den core, not where the last goal left them.
  if (home) return { kind: "wander", to: homeCenter(home), untilTick: state.tick + WANDER_TICKS };
  return { kind: "rest", untilTick: state.tick + REST_TICKS };
}

function passable(state: SimulationState, p: Position): boolean {
  return !isMoveBlocked(p.x, p.y, state.grid, state.grid.getTerrain(p.x, p.y));
}

// ponytail: greedy step along the longer axis, then the other one. A beast
// behind water gets no step, its goal ends, and it re-asks at most once per
// ASK_INTERVAL_TICKS; switch to BFS over passable tiles if maps get obstacles.
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

/** One frame toward the goal, or null when the goal is done or no longer valid. */
export function nextFrame(agent: Agent, goal: Goal, state: SimulationState): InputFrame | null {
  switch (goal.kind) {
    case "attack": {
      const target = visibleEnemies(agent, state).find((e) => e.id === goal.targetId);
      if (!target || !isThreat(agent, target, state)) return null;
      if (distance(agent.position, target.position) === 1) {
        const dir = stepToward(agent, target.position, state) ?? agent.facing;
        // Turn-before-move: a direction frame toward an adjacent tile only turns.
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
      const d = distance(agent.position, goal.tile);
      if (d === 0) return null;
      if (d === 1) {
        const dir = stepToward(agent, goal.tile, state) ?? agent.facing;
        // Turn-before-move: a direction frame toward an adjacent tile only turns.
        if (dir !== agent.facing) return move(dir);
        return { seq: 0, action: { type: "gather", resourceTile: { ...goal.tile } } };
      }
      const dir = stepToward(agent, goal.tile, state);
      return dir ? move(dir) : null;
    }
    case "store": {
      const home = homeOf(agent, state);
      if (!home || agent.inventory.food === 0) return null;
      if (home.isInTerritory(agent.position)) {
        return { seq: 0, action: { type: "deposit", settlementId: home.id } };
      }
      const dir = stepToward(agent, homeCenter(home), state);
      return dir ? move(dir) : null;
    }
    case "wander": {
      if (state.tick >= goal.untilTick) return null;
      // Hold the spot until the deadline: a patrol point is often 1-2 steps
      // away, and ending on arrival made a paid call every second. A threat
      // in sight ends the hold, so a guard does not stand still while hit.
      if (distance(agent.position, goal.to) === 0) {
        const threat = visibleEnemies(agent, state).some((e) => isThreat(agent, e, state));
        return threat ? null : { seq: 0, action: { type: "idle" } };
      }
      const dir = stepToward(agent, goal.to, state);
      return dir ? move(dir) : null;
    }
    case "rest":
    case "roar":
      return state.tick >= goal.untilTick ? null : { seq: 0, action: { type: "idle" } };
  }
}

/**
 * Drives every alive agent with controller "llm": code lists the options, Jev
 * picks one, code turns the picked goal into one InputFrame per tick.
 * Call once per tick before processTick.
 */
export class JevController {
  private goals = new Map<string, Goal>();
  private pending = new Set<string>();
  private lastAskTick = new Map<string, number>();
  private nextMoveTick = new Map<string, number>();

  constructor(private choose: ChooseFn | null, private rand = Math.random) {}

  update(state: SimulationState): void {
    for (const agent of state.agents.values()) {
      if (agent.controller !== "llm") continue;
      // A dead agent's goal must not survive into its respawn.
      if (!agent.isAlive()) { this.goals.delete(agent.id); continue; }
      if (agent.planBacklog.length > 0) continue;

      const goal = this.goals.get(agent.id);
      const frame = goal && nextFrame(agent, goal, state);
      if (frame) {
        if (frame.direction) {
          if (state.tick < (this.nextMoveTick.get(agent.id) ?? 0)) continue; // keep the goal, wait
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
    // One call in flight per agent: the agent idles until the answer arrives.
    if (this.pending.has(agent.id)) return;
    const last = this.lastAskTick.get(agent.id);
    if (last !== undefined && state.tick - last < ASK_INTERVAL_TICKS) return;
    this.pending.add(agent.id);
    this.lastAskTick.set(agent.id, state.tick);

    const askedTick = state.tick;
    const options = buildOptions(agent, state, this.rand);
    const criteria = Object.fromEntries(options.map((o) => [o.id, o.description]));
    this.choose(describeState(agent, state), INSTRUCTIONS, criteria)
      .then(({ id, usage }) => {
        // The token counts let the server log give the Jev cost per hour.
        const cost = usage ? ` (in ${usage.input}, out ${usage.output})` : "";
        console.log(`[jev] ${agent.id} chose ${id} from ${Object.keys(criteria).join(", ")}${cost}`);
        // Died while waiting: a goal or a roar bubble would outlive the death.
        if (!agent.isAlive()) return;
        const goal = options.find((o) => o.id === id)!.goal;
        // Deadlines count from the reply: a slow call must not use up the goal.
        if ("untilTick" in goal) goal.untilTick += state.tick - askedTick;
        // Set here, not in nextFrame: buildOptions calls nextFrame to test options.
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
