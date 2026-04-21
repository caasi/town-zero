// Type-only regression tests for the NpcBuilder.on() overloads and the
// EventEffect return contract. These files are compiled under
// `tsconfig.type-tests.json` with `noEmit: true`; they produce no runtime
// output. Negative cases use `// @ts-expect-error` so a regression in the
// overload signatures turns a silent-pass into a compile error.
//
// Keep this file's imports limited to public surface (shared/src/script-dsl).

import { scenario, bubble } from "../src/script-dsl/index.js";

scenario("type-tests", (s) => {
  const npc = s.npc("n1", {
    role: "villager",
    faction: "f",
    position: { x: 0, y: 0 },
    initialBeliefs: [],
  });

  // --- Valid usage: each event key narrows the payload to its declared type.

  npc.on("proximity:enter", ({ player, distance, self, tick }) => {
    void player.id; void distance; void self.id; void tick;
    return [];
  });

  npc.on("proximity:stay", ({ ticksInRange }) => {
    void ticksInRange;
    return [];
  });

  npc.on("talk:end", ({ reason }) => {
    // reason is the closed union; widening to `string` via assignment is fine,
    // but the field itself must exist.
    const r: "completed" | "timeout" | "player_left" | "npc_killed" | "error" = reason;
    void r;
    return [];
  });

  npc.on("combat:hit", ({ attacker, damage, hpAfter }) => {
    void attacker.id; void damage; void hpAfter;
    return [];
  });

  npc.on("combat:death", ({ killer }) => {
    // killer is nullable: scripted-trigger damage has no attacker.
    void killer?.id;
    return [];
  });

  // Returning a bubble effect from a handler is fine.
  npc.on("proximity:enter", ({ self }) => [bubble(self.id, "hi", { durationTicks: 20 })]);

  // --- Negative cases: each of these must fail to compile. Removing any
  // `@ts-expect-error` line should fail the typecheck (`tsc --noEmit`) —
  // that's what keeps the overloads honest.

  // @ts-expect-error — unknown event name
  npc.on("proximity:teleport", () => []);

  // @ts-expect-error — proximity:enter has no `attacker`
  npc.on("proximity:enter", ({ attacker }) => { void attacker; return []; });

  // @ts-expect-error — proximity:leave has no `ticksInRange`
  npc.on("proximity:leave", ({ ticksInRange }) => { void ticksInRange; return []; });

  // @ts-expect-error — combat:death has no `damage`
  npc.on("combat:death", ({ damage }) => { void damage; return []; });

  // @ts-expect-error — handlers must return EventEffect[], not Effect.
  // `set_fact` lives in the general Effect union and is intentionally excluded
  // from EventEffect so script-level triggers stay the only path for it.
  npc.on("proximity:enter", () => [{ type: "set_fact", target: "$npc", key: "k", value: { kind: "lit", value: true } }]);

  // @ts-expect-error — bubble.durationTicks is required; passing no opts breaks.
  bubble("$npc", "hi");
});
