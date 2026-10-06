import { DIRECTION_DELTA, TERRAIN_MOVE_COST } from "@town-zero/shared";
import type { Facing, InputFrame, Position } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import type { SimulationState } from "../simulation/tick.js";
import type { ChooseFn } from "./jev.js";

export type Goal =
  | { kind: "attack"; targetId: string; readyTick?: number }
  | { kind: "eat" }
  | { kind: "flee" }
  | { kind: "wander"; to: Position; untilTick: number }
  | { kind: "rest"; untilTick: number };

export interface Option {
  id: string;
  description: string;
  goal: Goal;
}

const INSTRUCTIONS = "You are this beast. Which plan should it follow next?";
const WANDER_RADIUS = 4;
const WANDER_TICKS = 40; // ~5s
const REST_TICKS = 24;   // ~3s
const TAKE_FOOD = 3;
// One attack per frame would be 8 hits/s; three beasts killed a player in under 1 s.
const ATTACK_COOLDOWN_TICKS = 8; // ~1 attack/s
// Backstop for the "every option yields a frame" rule: a goal that ends at
// once (blocked path, bad option) must not turn into a paid call every tick.
const ASK_INTERVAL_TICKS = 8; // ~1 Jev call/s per agent at most

const distance = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function homeOf(agent: Agent, state: SimulationState): Settlement | undefined {
  return Array.from(state.settlements.values()).find((s) => s.populationIds.includes(agent.id));
}

function homeCenter(home: Settlement): Position {
  return home.structures.find((s) => s.type === "core")?.position ?? home.territory[0];
}

/** Enemies this agent sees now, read from its own MapMemory (no global knowledge). */
function visibleEnemies(agent: Agent, state: SimulationState): Agent[] {
  const ids = new Set<string>();
  for (const [, mem] of agent.getAllMemory()) {
    if (mem.timestamp !== state.tick) continue;
    for (const e of mem.entities) if (e.faction !== agent.faction) ids.add(e.id);
  }
  return [...ids].map((id) => state.agents.get(id)).filter((a): a is Agent => !!a?.isAlive());
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
  const to = {
    x: clamp(agent.position.x + Math.round((rand() * 2 - 1) * WANDER_RADIUS), state.grid.width),
    y: clamp(agent.position.y + Math.round((rand() * 2 - 1) * WANDER_RADIUS), state.grid.height),
  };
  const options: Option[] = [
    { id: "rest", description: "Stay where you are.", goal: { kind: "rest", untilTick: state.tick + REST_TICKS } },
  ];
  if (stepToward(agent, to, state)) {
    options.push({ id: "wander", description: "Walk around to look for something.", goal: { kind: "wander", to, untilTick: state.tick + WANDER_TICKS } });
  }
  const home = homeOf(agent, state);
  const enemies = visibleEnemies(agent, state);
  if (home && agent.inventory.food === 0 && home.inventory.food > 0) {
    options.push({ id: "eat_at_den", description: "Go back to the den and take food.", goal: { kind: "eat" } });
  }
  if (home && enemies.length > 0 && !home.isInTerritory(agent.position)) {
    options.push({ id: "flee_to_den", description: "Run away from enemies to the den.", goal: { kind: "flee" } });
  }
  for (const enemy of enemies) {
    options.push({
      id: `attack:${enemy.id}`,
      description: `Walk to ${enemy.id} and attack it.`,
      goal: { kind: "attack", targetId: enemy.id },
    });
  }
  return options;
}

/** Short, decision-relevant state: accuracy drops as unrelated content grows. */
export function describeState(agent: Agent, state: SimulationState): Record<string, unknown> {
  const home = homeOf(agent, state);
  const food = agent.inventory.food;
  const enemies = visibleEnemies(agent, state).map((e) =>
    `${e.id}, an enemy ${e.role}, ${distance(agent.position, e.position)} steps away, HP ${e.hp} of ${e.maxHp}`);
  return {
    self: `a ${agent.role} of the den. HP ${agent.hp} of ${agent.maxHp}. Carrying ${food} food.${food === 0 ? " Hungry." : ""}`,
    home: !home
      ? "no home"
      : home.isInTerritory(agent.position)
        ? `inside the den, which holds ${home.inventory.food} food`
        : `the den is ${distance(agent.position, homeCenter(home))} steps away and holds ${home.inventory.food} food`,
    visible: enemies.length > 0 ? enemies : "no enemies in sight",
  };
}

/** Used when no Jev key is set or a call fails, so the game still runs. */
export function fallbackGoal(agent: Agent, state: SimulationState): Goal {
  const home = homeOf(agent, state);
  if (agent.inventory.food === 0 && home && home.inventory.food > 0) return { kind: "eat" };
  return { kind: "rest", untilTick: state.tick + REST_TICKS };
}

function passable(state: SimulationState, p: Position): boolean {
  if (!state.grid.inBounds(p.x, p.y)) return false;
  const terrain = state.grid.getTerrain(p.x, p.y);
  return !!terrain && TERRAIN_MOVE_COST[terrain] !== Infinity;
}

// ponytail: greedy step along the longer axis, then the other one. A beast
// stuck behind water stays stuck until its goal times out or it re-plans;
// switch to BFS over passable tiles if maps get obstacles between dens and targets.
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
      const target = state.agents.get(goal.targetId);
      if (!target?.isAlive() || !visibleEnemies(agent, state).includes(target)) return null;
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
    case "wander": {
      if (state.tick >= goal.untilTick || distance(agent.position, goal.to) === 0) return null;
      const dir = stepToward(agent, goal.to, state);
      return dir ? move(dir) : null;
    }
    case "rest":
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

  constructor(private choose: ChooseFn | null, private rand = Math.random) {}

  update(state: SimulationState): void {
    for (const agent of state.agents.values()) {
      if (agent.controller !== "llm" || !agent.isAlive()) continue;
      if (agent.planBacklog.length > 0) continue;

      const goal = this.goals.get(agent.id);
      const frame = goal && nextFrame(agent, goal, state);
      if (frame) {
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
      .then((id) => {
        console.log(`[jev] ${agent.id} chose ${id} from ${Object.keys(criteria).join(", ")}`);
        const goal = options.find((o) => o.id === id)!.goal;
        // Deadlines count from the reply: a slow call must not use up the goal.
        if ("untilTick" in goal) goal.untilTick += state.tick - askedTick;
        this.goals.set(agent.id, goal);
      })
      .catch((err) => {
        console.error(`[jev] decision failed for ${agent.id}:`, err);
        this.goals.set(agent.id, fallbackGoal(agent, state));
      })
      .finally(() => this.pending.delete(agent.id));
  }
}
