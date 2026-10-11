import { scenario, bubble } from "../src/script-dsl/index.js";

scenario("type-tests", (s) => {
  const npc = s.npc("n1", { gender: { kind: "male" }, personality: "A plain villager.",
    role: "villager",
    faction: "f",
    position: { x: 0, y: 0 },
    initialBeliefs: [],
  });

  npc.on("proximity:enter", ({ player, distance, self, tick }) => {
    void player.id; void distance; void self.id; void tick;
    return [];
  });

  npc.on("proximity:stay", ({ ticksInRange }) => {
    void ticksInRange;
    return [];
  });

  npc.on("talk:end", ({ reason }) => {
    const r: "completed" | "timeout" | "player_left" | "npc_killed" | "error" = reason;
    void r;
    return [];
  });

  npc.on("combat:hit", ({ attacker, damage, hpAfter }) => {
    void attacker?.id; void damage; void hpAfter;
    return [];
  });

  npc.on("combat:death", ({ killer }) => {
    void killer?.id;
    return [];
  });

  npc.on("proximity:enter", ({ self }) => [bubble(self.id, "hi", { durationTicks: 20 })]);

  // @ts-expect-error — unknown event name
  npc.on("proximity:teleport", () => []);

  // @ts-expect-error — proximity:enter has no `attacker`
  npc.on("proximity:enter", ({ attacker }) => { void attacker; return []; });

  // @ts-expect-error — proximity:leave has no `ticksInRange`
  npc.on("proximity:leave", ({ ticksInRange }) => { void ticksInRange; return []; });

  // @ts-expect-error — combat:death has no `damage`
  npc.on("combat:death", ({ damage }) => { void damage; return []; });

  // @ts-expect-error — handlers must return EventEffect[], not Effect.
  npc.on("proximity:enter", () => [{ type: "set_fact", target: "$npc", key: "k", value: { type: "literal", value: true } }]);

  // @ts-expect-error — bubble.durationTicks is required; passing no opts breaks.
  bubble("$npc", "hi");
});
