import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { applyDamage } from "../../src/simulation/apply-damage.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EventHandler, CombatHitPayload, CombatDeathPayload } from "@town-zero/shared/script-dsl";

function buildState(): SimulationState {
  return {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map(),
  };
}

describe("applyDamage", () => {
  it("fires combat:hit with attacker, damage, hpAfter", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const hits: CombatHitPayload[] = [];
    victim.eventHandlers.set("combat:hit", [((p: CombatHitPayload) => { hits.push(p); return []; }) as EventHandler<unknown>]);

    applyDamage(victim, 10, attacker, state);
    expect(hits).toHaveLength(1);
    expect(hits[0].attacker.id).toBe("a1");
    expect(hits[0].damage).toBe(10);
    expect(hits[0].hpAfter).toBe(victim.hp);
  });

  it("fires combat:death only on killing blow and strictly after combat:hit", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const seq: string[] = [];
    victim.eventHandlers.set("combat:hit", [((p: CombatHitPayload) => { seq.push(`hit:${p.hpAfter}`); return []; }) as EventHandler<unknown>]);
    victim.eventHandlers.set("combat:death", [((p: CombatDeathPayload) => { seq.push(`death:${p.killer?.id ?? "null"}`); return []; }) as EventHandler<unknown>]);

    applyDamage(victim, victim.hp, attacker, state);
    expect(seq).toEqual(["hit:0", "death:a1"]);
  });

  it("does not fire combat:death on non-lethal hits", () => {
    const state = buildState();
    const attacker = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "hostile", role: "warrior", controller: "bot" });
    const victim = new Agent({ id: "v1", position: { x: 1, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    state.agents.set(attacker.id, attacker); state.agents.set(victim.id, victim);
    const deaths: string[] = [];
    victim.eventHandlers.set("combat:death", [((p: CombatDeathPayload) => { deaths.push(p.killer?.id ?? "null"); return []; }) as EventHandler<unknown>]);
    applyDamage(victim, 1, attacker, state);
    expect(deaths).toEqual([]);
  });
});
