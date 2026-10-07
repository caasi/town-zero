import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { JevController } from "../../src/ai/jev-controller.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { Grid } from "../../src/simulation/grid.js";
import type { SimulationState } from "../../src/simulation/tick.js";

// Jev replies arrive late and in any order, mixed with ticks, deaths and
// respawns. Whatever the order: one call in flight per beast, asks at least
// ASK_INTERVAL_TICKS (8) apart, and no goal for a dead beast.

const ASK_INTERVAL_TICKS = 8;

function setup() {
  const den = new Settlement({ id: "den-1", faction: "den-1", type: "den", territory: [{ x: 2, y: 2 }, { x: 3, y: 2 }] });
  den.addStructure({ id: "core", type: "core", position: { x: 2, y: 2 } });
  den.addResource("food", 10);
  const beasts = ["b1", "b2"].map((id, i) => {
    den.populationIds.push(id);
    return new Agent({ id, position: { x: 2 + i, y: 2 }, faction: "den-1", role: "beast", controller: "llm" });
  });
  const player = new Agent({ id: "p1", position: { x: 5, y: 2 }, faction: "village-1", role: "player", controller: "player" });
  const state: SimulationState = {
    grid: new Grid(12, 12), tick: 0,
    agents: new Map([...beasts.map((b) => [b.id, b] as const), ["p1", player]]),
    settlements: new Map([["den-1", den]]),
    activeSessions: new Map(), dialogueTrees: new Map(),
  };
  return { state, beasts, player };
}

const step = fc.oneof(
  { weight: 4, arbitrary: fc.constant({ kind: "tick" as const }) },
  { weight: 3, arbitrary: fc.constant({ kind: "resolve" as const }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("kill" as const), who: fc.nat(1) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("revive" as const), who: fc.nat(1) }) },
);

// One answer per call, used in order: an index into the offered ids, or a failed call.
const answer = fc.oneof(fc.nat(9), fc.constant("fail" as const));

describe("Jev reply timing (property)", () => {
  it("one call in flight, asks spaced, no goal for the dead", async () => {
    let asks = 0;
    let lateReplies = 0; // replies that arrived while their own beast was dead
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fc.assert(
      fc.asyncProperty(fc.scheduler(), fc.array(step, { minLength: 50, maxLength: 200 }), fc.infiniteStream(answer),
        async (s, steps, answers) => {
          const { state, beasts, player } = setup();
          const inFlight = new Map<string, number>();
          const askTicks = new Map<string, number[]>();
          let caller = "";
          // scheduleFunction calls the function at once and holds its promise:
          // a rejection made there is unhandled until release. So the
          // scheduled value says "fail", and the rejection is made after release.
          const scheduled = s.scheduleFunction(async (criteria: Record<string, string>) => {
            const a = answers.next().value;
            return a === "fail" ? null : Object.keys(criteria)[a % Object.keys(criteria).length];
          });
          const reply = (criteria: Record<string, string>) => scheduled(criteria).then((id) => {
            if (id === null) throw new Error("Jev down");
            return { id };
          });
          const controller = new JevController((_state, _instructions, criteria) => {
            asks++;
            const id = caller;
            inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
            expect(inFlight.get(id), `${id}: second call in flight`).toBe(1);
            const ticks = askTicks.get(id) ?? [];
            const last = ticks[ticks.length - 1];
            if (last !== undefined) expect(state.tick - last, `${id}: asked again too soon`).toBeGreaterThanOrEqual(ASK_INTERVAL_TICKS);
            askTicks.set(id, [...ticks, state.tick]);
            return reply(criteria).finally(() => {
              inFlight.set(id, inFlight.get(id)! - 1);
              if (!state.agents.get(id)!.isAlive()) lateReplies++;
            });
          });
          // The chooser is not told which agent asks; update() asks in agent order,
          // so record the caller by wrapping the per-agent decision.
          const decide = (controller as any).decide.bind(controller);
          (controller as any).decide = (agent: Agent, st: SimulationState) => { caller = agent.id; decide(agent, st); };

          for (const st of steps) {
            if (st.kind === "tick") {
              state.tick++;
              for (const b of beasts) {
                b.recordTile(player.position.x, player.position.y, "plains",
                  [{ id: "p1", type: "agent", faction: player.faction, position: { ...player.position }, role: player.role, hp: player.hp, maxHp: player.maxHp }], state.tick);
              }
              controller.update(state);
              for (const b of beasts) b.planBacklog = []; // the tick consumes the frame
              for (const b of beasts) {
                if (!b.isAlive()) expect(controller.getGoal(b.id), `${b.id} is dead but has a goal`).toBeUndefined();
              }
            } else if (st.kind === "resolve") {
              if (s.count() === 0) continue;
              // A reply that arrives after death must add no goal and no roar bubble.
              const before = beasts.map((b) => ({ dead: !b.isAlive(), goal: controller.getGoal(b.id), bubble: b.bubbleText }));
              await s.waitNext(1);
              // The controller's .then/.catch run a few microtasks after the reply.
              await new Promise((r) => setTimeout(r, 0));
              beasts.forEach((b, i) => {
                // Not checked: a beast that died and came back before its reply.
                // The controller would take that reply. It cannot happen in the
                // game: a beast respawns after ~30 s, a Jev call times out after 5 s.
                if (!before[i].dead || b.isAlive()) return;
                if (before[i].goal === undefined) expect(controller.getGoal(b.id), `${b.id}: goal set while dead`).toBeUndefined();
                if (before[i].bubble === null) expect(b.bubbleText, `${b.id}: roars while dead`).toBeNull();
              });
            } else if (st.kind === "kill") {
              beasts[st.who].takeDamage(1_000_000);
            } else {
              const b = beasts[st.who];
              if (!b.isAlive()) b.revive({ x: 2 + st.who, y: 2 });
            }
          }
          await s.waitIdle();
        }),
      { numRuns: 300 },
    );
    // Guard against a property that passes because nothing happened.
    expect(asks).toBeGreaterThan(500); // ~1350 seen
    expect(lateReplies).toBeGreaterThan(100); // ~190 seen
  });
});
