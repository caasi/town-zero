import { scenario, setFact, take, fact, literal, player, bubble } from "@town-zero/shared/script-dsl";

export const farmerReedScenario = scenario("farmer-reed", (s) => {
  s.npc("farmer-reed", {
    name: "Farmer Reed",
    role: "farmer",
    faction: "village-1",
    position: { x: 9, y: 19 },
    initialBeliefs: [],
    gender: { kind: "male" },
    // Wording checked with real Jev calls (spec 004): it picks the
    // common-good reply at 98%.
    personality: "He cares most about the village. He thinks everyone must do their part.",
    farewells: [
      { text: "Don't forget the food! The storehouse won't fill itself.", when: fact("food_quest_active").eq(true) },
      "I'll be in the fields if you need me.",
    ],
  })
  .on("proximity:enter", ({ self }) => [
    bubble(self.id, "Greetings, traveler!", { durationTicks: 40 }),
  ])
  .on("talk:start", ({ self }) => [
    bubble(self.id, "", { durationTicks: 0 }),
  ]);

  s.dialogue("farmer-reed", "farmer-reed-dialogue", (d) => {
    // --- Default path: greeting → quest-offer ---
    d.text("greeting", ["Our food stores are running low. Could you gather 5 food from the bushes nearby?"], { next: "quest-offer" });

    d.choice("quest-offer", [
      d.option("Sure, I'll help.").goto("accept"),
      d.option("What's in it for me?").goto("haggle"),
      d.option("Not right now.").goto("refuse"),
    ]);

    d.action("accept", [
      setFact("$npc", "food_quest_active", true),
    ], { next: "accept-text" });

    d.text("accept-text", ["Thank you! Bring me 5 food when you can."], { next: "done" });

    // Jev picks from his personality and the storehouse (spec 004); the first
    // line is the fallback. A line changes with the state only when another
    // line fits the same personality in another situation (real runs: low
    // food → "hungry", a full storehouse → "common-good").
    d.reply("haggle", [
      d.line("common-good", "Explain calmly that the whole village benefits when there is enough food.",
        "The whole village eats from the same storehouse. You too, while you stay in Tandi.").goto("quest-offer"),
      d.line("hungry", "Say firmly that everyone must do their part now, because the storehouse is almost empty.",
        "We're down to the last sacks. Everyone in Tandi does their part now, and that means you too.").goto("quest-offer"),
      d.line("reward", "Offer the traveler a share of the next harvest as a reward.",
        "Help us, and I'll set aside a sack from the next harvest for you. Deal?").goto("quest-offer"),
      d.line("curt", "Answer curtly that there is no time to bargain.",
        "I've no time to haggle. Help, or let me get back to the fields.").goto("quest-offer"),
    ]);

    d.text("refuse", ["I understand. Come back if you change your mind."], { next: "done" });

    // --- Return path: check-return (entry when food_quest_active) ---
    d.text("check-return", ["Welcome back. Do you have the food?"], { next: "check-food" });

    d.choice("check-food", [
      d.option("Here you go.").when(player.hasItem("food", 5)).goto("hand-over"),
      d.option("Not yet.").goto("not-yet"),
    ]);

    d.action("hand-over", [
      take("$player", "food", 5),
      setFact("$npc", "food_quest_active", false),
    ], { next: "thanks" });

    d.text("thanks", ["Wonderful! This will keep the village fed for a while."], { next: "done" });

    d.text("not-yet", ["No rush. Come back when you have 5 food."], { next: "done" });

    d.end("done");

    // Entry points (evaluated in order; first match wins):
    // - If quest is active, resume at check-return.
    // - Otherwise, always enter at greeting — this also makes the dispatcher's
    //   rule 2 (dialogue-entry match) fire on KeyE for Reed at rest.
    d.entry("check-return", fact("food_quest_active").eq(true));
    d.entry("greeting", literal(true));
  });
});
