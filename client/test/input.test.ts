import { describe, it, expect, vi, afterEach } from "vitest";
import { TICK_RATE_MS } from "@town-zero/shared";
import type { DisplayState } from "../src/display.js";

type Listener = (e: Partial<KeyboardEvent>) => void;
const listeners = new Map<string, Listener>();

vi.stubGlobal("window", {
  addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  removeEventListener: () => {},
});
vi.stubGlobal("document", {
  addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  removeEventListener: () => {},
  activeElement: null,
});
vi.stubGlobal("HTMLInputElement", class {});

const { InputHandler } = await import("../src/input.js");

const FRAME_MS = 16;
const START = 10_000;

function setup() {
  const handler = new InputHandler();
  const sent: (string | undefined)[] = [];
  const stepTimes: number[] = [];
  handler.onSendInput = (frame) => sent.push(frame.direction ?? frame.action?.type);
  handler.setPlayerInfo({ x: 5, y: 5, faction: "village" });
  const display = {
    getLocalPlayerPosition: () => null,
    predictMove: (_x: number, _y: number, _state: string, _tiles: unknown, stepAt: number) => stepTimes.push(stepAt),
  } as unknown as DisplayState;
  handler.setPredictionContext(display, { get: () => ({ terrain: "grass" }) });
  return { handler, sent, stepTimes };
}

const key = (type: "keydown" | "keyup", code: string, repeat = false) =>
  listeners.get(type)!({ code, repeat, preventDefault: () => {}, target: null });

function runFrames(handler: InstanceType<typeof InputHandler>, untilMs: number, events: Record<number, () => void> = {}) {
  for (let t = FRAME_MS; t <= untilMs; t += FRAME_MS) {
    events[t]?.();
    handler.update(START + t);
  }
}

describe("InputHandler move buffer", () => {
  afterEach(() => {
    listeners.clear();
    (document as unknown as { activeElement: unknown }).activeElement = null;
  });

  function stepEast(handler: InstanceType<typeof InputHandler>) {
    key("keydown", "KeyD");
    handler.update(START);
    key("keyup", "KeyD");
  }

  it("sends a tap that is released before the next step is allowed", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    runFrames(handler, 4 * TICK_RATE_MS, {
      48: () => key("keydown", "KeyW"),
      112: () => key("keyup", "KeyW"),
    });
    expect(sent).toEqual(["east", "north"]);
  });

  it("keeps only the last tap", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    runFrames(handler, 4 * TICK_RATE_MS, {
      32: () => { key("keydown", "KeyW"); key("keyup", "KeyW"); },
      64: () => { key("keydown", "KeyA"); key("keyup", "KeyA"); },
    });
    expect(sent).toEqual(["east", "west"]);
  });

  it("does not buffer key repeat", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    runFrames(handler, 4 * TICK_RATE_MS, {
      32: () => { key("keydown", "KeyW", true); key("keyup", "KeyW"); },
    });
    expect(sent).toEqual(["east"]);
  });

  it("drops the tap when a dialogue opens", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    handler.enterDialogueMode();
    handler.exitDialogueMode();
    runFrames(handler, 4 * TICK_RATE_MS);
    expect(sent).toEqual(["east"]);
  });

  it("drops the tap when the window loses focus", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    listeners.get("blur")!({});
    runFrames(handler, 4 * TICK_RATE_MS);
    expect(sent).toEqual(["east"]);
  });

  it("drops the tap when input is disabled", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    handler.setEnabled(false);
    runFrames(handler, 4 * TICK_RATE_MS, {
      256: () => handler.setEnabled(true),
    });
    expect(sent).toEqual(["east"]);
  });

  it("drops the tap when an input field has focus", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    key("keydown", "KeyW");
    key("keyup", "KeyW");
    const doc = document as unknown as { activeElement: unknown };
    doc.activeElement = new HTMLInputElement();
    handler.update(START);
    doc.activeElement = null;
    runFrames(handler, 4 * TICK_RATE_MS);
    expect(sent).toEqual(["east"]);
  });

  it("sends a short touch on the pad", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    runFrames(handler, 4 * TICK_RATE_MS, {
      48: () => handler.setTouchDirection("TouchUp"),
      80: () => handler.setTouchDirection(null),
    });
    expect(sent).toEqual(["east", "north"]);
  });

  it("ignores a touch while input is disabled", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    handler.setEnabled(false);
    handler.setTouchDirection("TouchUp");
    handler.setTouchDirection(null);
    handler.setEnabled(true);
    runFrames(handler, 4 * TICK_RATE_MS);
    expect(sent).toEqual(["east"]);
  });

  it("ignores a touch in a dialogue", () => {
    const { handler, sent } = setup();
    stepEast(handler);
    handler.enterDialogueMode();
    handler.setTouchDirection("TouchUp");
    handler.setTouchDirection(null);
    handler.exitDialogueMode();
    runFrames(handler, 4 * TICK_RATE_MS);
    expect(sent).toEqual(["east"]);
  });

  it("still steps every tick while a key is held", () => {
    const { handler, sent } = setup();
    key("keydown", "KeyW");
    handler.update(START);
    runFrames(handler, 2 * TICK_RATE_MS + FRAME_MS);
    expect(sent).toEqual(["north", "north", "north"]);
  });

  it("steps on a fixed clock of one tick while a key is held", () => {
    const { handler, stepTimes } = setup();
    key("keydown", "KeyW");
    handler.update(START);
    runFrames(handler, 8 * TICK_RATE_MS);
    const gaps = stepTimes.slice(1).map((t, i) => t - stepTimes[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(7);
    expect(new Set(gaps)).toEqual(new Set([TICK_RATE_MS]));
  });

  it("starts a new walk at the time of the key press", () => {
    const { handler, stepTimes } = setup();
    stepEast(handler);
    runFrames(handler, 1008, {
      1008: () => key("keydown", "KeyW"),
    });
    expect(stepTimes).toEqual([START, START + 1008]);
  });

  it("stamps each step with the frame time it is given, not the wall clock", () => {
    const { handler, stepTimes } = setup();
    key("keydown", "KeyW");
    handler.update(5_000);
    handler.update(5_000 + TICK_RATE_MS);
    expect(stepTimes).toEqual([5_000, 5_000 + TICK_RATE_MS]);
  });

  it("starts a new key press at its own frame time, also just after a step", () => {
    const { handler, stepTimes } = setup();
    stepEast(handler);
    runFrames(handler, 144, {
      144: () => key("keydown", "KeyW"),
    });
    expect(stepTimes).toEqual([START, START + 144]);
  });

  it("keeps the step clock when a held step is a little late", () => {
    const { handler, stepTimes } = setup();
    key("keydown", "KeyW");
    handler.update(START);
    handler.update(START + TICK_RATE_MS + 30);
    handler.update(START + 2 * TICK_RATE_MS);
    expect(stepTimes).toEqual([START, START + TICK_RATE_MS, START + 2 * TICK_RATE_MS]);
  });

  it("restarts the step clock when a held step is too late", () => {
    const { handler, stepTimes } = setup();
    key("keydown", "KeyW");
    handler.update(START);
    handler.update(START + TICK_RATE_MS + 40);
    expect(stepTimes).toEqual([START, START + TICK_RATE_MS + 40]);
  });
});
