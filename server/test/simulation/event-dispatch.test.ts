import { describe, it, expect, vi } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { dispatch, applyEventEffects } from "../../src/simulation/event-dispatch.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EntityRef, ProximityEnterPayload } from "@town-zero/shared/script-dsl";
import { bubble } from "@town-zero/shared/script-dsl";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

function refOf(a: Agent): EntityRef {
  return { id: a.id, faction: a.faction, role: a.role, position: { ...a.position } };
}

describe("dispatch", () => {
  it("flatMaps multiple handler results in registration order", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.eventHandlers.set("proximity:enter", [
      () => [bubble("n1", "one", { durationTicks: 1 })],
      () => [bubble("n1", "two", { durationTicks: 1 })],
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    const effects = dispatch(npc, "proximity:enter", payload);
    expect(effects.map(e => (e.type === "bubble" ? e.text : e.type))).toEqual(["one", "two"]);
  });

  it("isolates throwing handler — remaining handlers still run", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.eventHandlers.set("proximity:enter", [
      () => { throw new Error("boom"); },
      () => [bubble("n1", "survived", { durationTicks: 1 })],
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    const effects = dispatch(npc, "proximity:enter", payload);
    expect(effects).toHaveLength(1);
    expect((effects[0] as any).text).toBe("survived");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("snapshot-at-dispatch: newly registered handler does not fire this dispatch", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const calls: string[] = [];
    npc.eventHandlers.set("proximity:enter", [
      () => {
        calls.push("h1");
        npc.eventHandlers.get("proximity:enter")!.push(() => { calls.push("h-new"); return []; });
        return [];
      },
    ]);
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    dispatch(npc, "proximity:enter", payload);
    expect(calls).toEqual(["h1"]);
    dispatch(npc, "proximity:enter", payload);
    expect(calls).toEqual(["h1", "h1", "h-new"]);
  });

  it("returns [] when no handlers are registered", () => {
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const payload: ProximityEnterPayload = {
      tick: 0, self: refOf(npc), player: refOf(npc), distance: 0,
    };
    expect(dispatch(npc, "proximity:enter", payload)).toEqual([]);
  });
});

describe("applyEventEffects", () => {
  it("applies bubble effect to the target agent", () => {
    const state = buildState();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(npc.id, npc);
    applyEventEffects([bubble("n1", "hi", { durationTicks: 5 })], state);
    expect(npc.bubbleText).toBe("hi");
  });

  it("clears bubble when durationTicks is 0", () => {
    const state = buildState();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    npc.setBubble("prior", 10, 0);
    state.agents.set(npc.id, npc);
    applyEventEffects([bubble("n1", "", { durationTicks: 0 })], state);
    expect(npc.bubbleText).toBeNull();
  });
});
