import { describe, it, expect, vi, beforeAll } from "vitest";
import fc from "fast-check";
import { INPUT_QUEUE_CAP, REVIVE_DELAY_TICKS } from "@town-zero/shared";
import type { Facing } from "@town-zero/shared";
import { createTestRoom, joinClient, mockClient, sendInput, sendMessage, tick } from "./room-harness.js";

// The client predicts every frame it sends and drops it only when
// lastProcessedInput covers it. So every frame the server accepts must be
// run, or acknowledged when the server drops it. A frame dropped without an
// ack is a predicted move that never happens: the player is pulled back.

interface Model {
  maxSeq: number;
  maxQueued: number; // most frames allowed to wait on the server at once
  queued: number;    // frames waiting: each tick runs one, death clears them
  alive: boolean;    // a dead agent acknowledges frames at once, none wait
}

interface Real {
  room: any;
  client: any;
  agent: () => any;
  lastSeen: number; // lastProcessedInput after the previous command
}

function sendMoves(r: Real, m: Model, dirs: Facing[]): void {
  for (const direction of dirs) {
    const before = r.agent().inputQueue.map((f: { seq: number }) => f.seq);
    m.maxSeq++;
    sendInput(r.room, r.client, { seq: m.maxSeq, direction });
    const after = new Set(r.agent().inputQueue.map((f: { seq: number }) => f.seq));
    const lp = r.agent().lastProcessedInput;
    for (const seq of before) {
      if (!after.has(seq)) expect(seq, `frame ${seq} dropped at enqueue without an ack`).toBeLessThanOrEqual(lp);
    }
  }
}

// One tick, checked: an alive agent runs only the frame at the head of its
// queue, and that frame's seq becomes lastProcessedInput. A frame that leaves
// the queue any other way (death) must already be acknowledged.
function tickChecked(r: Real): void {
  const agent = r.agent();
  const wasAlive = agent.isAlive();
  const before = agent.inputQueue.map((f: { seq: number }) => f.seq);
  tick(r.room);
  const after = new Set(agent.inputQueue.map((f: { seq: number }) => f.seq));
  const removed = before.filter((seq: number) => !after.has(seq));
  const lp = agent.lastProcessedInput;
  if (wasAlive && agent.isAlive()) {
    expect(removed.length, `frames ${removed} left the queue in one tick`).toBeLessThanOrEqual(1);
    if (removed.length === 1) {
      expect(removed[0], "a frame other than the head left the queue").toBe(before[0]);
      expect(lp, `frame ${removed[0]} left the queue but was not run`).toBe(removed[0]);
    }
  } else {
    for (const seq of removed) expect(seq, `frame ${seq} dropped at death without an ack`).toBeLessThanOrEqual(lp);
  }
}

function checkAck(r: Real, m: Model): void {
  const lp = r.agent().lastProcessedInput;
  expect(lp).toBeGreaterThanOrEqual(r.lastSeen);
  expect(lp).toBeLessThanOrEqual(m.maxSeq);
  r.lastSeen = lp;
}

const dir = fc.constantFrom<Facing>("north", "south", "east", "west");

class Send implements fc.Command<Model, Real> {
  constructor(readonly dirs: Facing[]) {}
  check = (m: Readonly<Model>) => !m.alive || m.queued + this.dirs.length <= m.maxQueued;
  run(m: Model, r: Real) {
    sendMoves(r, m, this.dirs);
    if (m.alive) m.queued += this.dirs.length;
    checkAck(r, m);
  }
  toString = () => `send(${this.dirs.join(",")})`;
}

class Tick implements fc.Command<Model, Real> {
  constructor(readonly n: number) {}
  check = () => true;
  run(m: Model, r: Real) { for (let i = 0; i < this.n; i++) tickChecked(r); m.queued = Math.max(0, m.queued - this.n); checkAck(r, m); }
  toString = () => `tick(${this.n})`;
}

class Die implements fc.Command<Model, Real> {
  check = () => true;
  run(m: Model, r: Real) {
    // takeDamage clears the queue; it must acknowledge what it drops.
    const before = r.agent().inputQueue.map((f: { seq: number }) => f.seq);
    r.agent().takeDamage(1_000_000);
    for (const seq of before) expect(seq, `frame ${seq} dropped at death without an ack`).toBeLessThanOrEqual(r.agent().lastProcessedInput);
    tickChecked(r);
    m.alive = false; m.queued = 0; checkAck(r, m);
  }
  toString = () => "die";
}

class Revive implements fc.Command<Model, Real> {
  check = () => true;
  run(m: Model, r: Real) {
    for (let i = 0; i <= REVIVE_DELAY_TICKS; i++) tickChecked(r);
    sendMessage(r.room, r.client, "revive");
    m.alive = r.agent().isAlive();
    m.queued = 0; // the ticks above ran or cleared every waiting frame
    checkAck(r, m);
  }
  toString = () => "revive";
}

// A send of several frames is a burst between two ticks (network jitter).
const commands = fc.commands([
  fc.array(dir, { minLength: 1, maxLength: INPUT_QUEUE_CAP + 3 }).map((d) => new Send(d)),
  fc.integer({ min: 1, max: 3 }).map((n) => new Tick(n)),
  fc.constant(new Die()),
  fc.constant(new Revive()),
], { maxCommands: 30 });

function runAckProperty(maxQueued: number): void {
  fc.assert(
    fc.property(commands, (cmds) => {
      const { room } = createTestRoom();
      const client = mockClient("s1");
      joinClient(room, client, { name: "p" });
      const id = (room as any).sessionToAgent.get("s1");
      const real: Real = { room, client, agent: () => (room as any).simState.agents.get(id), lastSeen: 0 };
      const model: Model = { maxSeq: 0, maxQueued, queued: 0, alive: true };
      fc.modelRun(() => ({ model, real }), cmds);
      // Let the queue drain, as a released key does: then nothing is left unacknowledged.
      for (let i = 0; i < INPUT_QUEUE_CAP + 2; i++) tickChecked(real);
      expect(real.agent().lastProcessedInput).toBe(model.maxSeq);
    }),
    { numRuns: 200 },
  );
}

describe("input frames (property)", () => {
  // GameRoom logs every create and join; hundreds of generated rooms flood CI.
  beforeAll(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });

  it("every accepted frame is run or acknowledged", () => {
    runAckProperty(INPUT_QUEUE_CAP);
  });

  // Known violation (TODO.md, Known debt): when more than INPUT_QUEUE_CAP
  // frames wait (a burst, or more than one frame per tick for a while),
  // enqueueInput drops the oldest without an ack. The property found this
  // smallest case; it is pinned here so the result does not depend on the
  // generator. When the drop is fixed this test goes red: turn it into it().
  it.fails("four moves in one tick are all run or acknowledged", () => {
    const { room } = createTestRoom();
    const client = mockClient("s1");
    joinClient(room, client, { name: "p" });
    const id = (room as any).sessionToAgent.get("s1");
    const real: Real = { room, client, agent: () => (room as any).simState.agents.get(id), lastSeen: 0 };
    sendMoves(real, { maxSeq: 0, maxQueued: Infinity, queued: 0, alive: true }, ["north", "north", "north", "north"]);
  });
});
