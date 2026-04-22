import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { processTick, type SimulationState } from "../../src/simulation/tick.js";
import { purgeProximityState } from "../../src/rooms/proximity-state-cleanup.js";
import type { EventHandler, ProximityEnterPayload, ProximityStayPayload, ProximityLeavePayload } from "@town-zero/shared/script-dsl";

function buildWorld(): SimulationState {
  return {
    grid: new Grid(20, 20), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("Phase 6b — proximity event dispatch", () => {
  it("fires proximity:enter on the first tick a player is in range", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const seen: string[] = [];
    const h: EventHandler<ProximityEnterPayload> = ({ player }) => { seen.push(`enter:${player.id}`); return []; };
    npc.eventHandlers.set("proximity:enter", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    expect(seen).toEqual(["enter:p1"]);
  });

  it("fires proximity:stay on subsequent ticks with monotonic ticksInRange", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const stays: number[] = [];
    const h: EventHandler<ProximityStayPayload> = ({ ticksInRange }) => { stays.push(ticksInRange); return []; };
    npc.eventHandlers.set("proximity:stay", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    processTick(world);
    processTick(world);
    expect(stays).toEqual([1, 2]);
  });

  it("fires proximity:leave exactly once when player drops out of range", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const leaves: string[] = [];
    const h: EventHandler<ProximityLeavePayload> = ({ player }) => { leaves.push(player.id); return []; };
    npc.eventHandlers.set("proximity:leave", [h as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    player.position = { x: 19, y: 19 };
    processTick(world);
    processTick(world);
    expect(leaves).toEqual(["p1"]);
    expect(npc.proximityState.has("p1")).toBe(false);
  });

  it("re-enter resets ticksInRange to 1", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const stays: number[] = [];
    npc.eventHandlers.set("proximity:stay", [((p: any) => { stays.push(p.ticksInRange); return []; }) as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    processTick(world);
    player.position = { x: 19, y: 19 };
    processTick(world);
    player.position = { x: 6, y: 5 };
    processTick(world);
    processTick(world);
    expect(stays).toEqual([1, 1]);
  });

  it("disconnect cleanup lets a reconnecting player re-fire proximity:enter", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 5, y: 5 }, faction: "f", role: "villager", controller: "bot" });
    const enters: string[] = [];
    npc.eventHandlers.set("proximity:enter", [((p: ProximityEnterPayload) => { enters.push(p.player.id); return []; }) as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    processTick(world);
    expect(enters).toEqual(["p1"]);
    expect(npc.proximityState.get("p1")).toBe(2);

    // Simulate disconnect: GameRoom.onLeave removes the player agent and
    // calls purgeProximityState so the reconnecting player is treated as new.
    world.agents.delete("p1");
    purgeProximityState(world, "p1");
    expect(npc.proximityState.has("p1")).toBe(false);

    // Reconnect: same id returns within range.
    const reconnected = new Agent({ id: "p1", position: { x: 6, y: 5 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(reconnected.id, reconnected);
    processTick(world);

    expect(enters).toEqual(["p1", "p1"]);
    expect(npc.proximityState.get("p1")).toBe(1);
  });

  it("symmetry: enter fires whether NPC moves into range or player does", () => {
    const world = buildWorld();
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const enters: string[] = [];
    npc.eventHandlers.set("proximity:enter", [((p: any) => { enters.push(p.player.id); return []; }) as EventHandler<unknown>]);
    const player = new Agent({ id: "p1", position: { x: 19, y: 19 }, faction: "player", role: "player", controller: "player" });
    world.agents.set(npc.id, npc);
    world.agents.set(player.id, player);

    processTick(world);
    npc.position = { x: 18, y: 19 };
    processTick(world);
    expect(enters).toEqual(["p1"]);
  });
});
