import { describe, it, expect } from "vitest";
import { processCombat } from "../../src/simulation/combat.js";
import { Agent } from "../../src/simulation/agent.js";
import { BASE_ATTACK_DAMAGE } from "@town-zero/shared";

describe("processCombat", () => {
  it("deals damage to target", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });
    attacker.state = "fighting";

    processCombat(attacker, target);
    expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
  });

  it("kills target when HP reaches 0", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm", hp: 10 });
    attacker.state = "fighting";

    processCombat(attacker, target);
    expect(target.isAlive()).toBe(false);
    expect(target.state).toBe("dead");
  });

  it("does nothing if attacker is not fighting", () => {
    const attacker = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "hunter", controller: "llm" });
    const target = new Agent({ id: "a2", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "llm" });

    processCombat(attacker, target);
    expect(target.hp).toBe(100);
  });
});
