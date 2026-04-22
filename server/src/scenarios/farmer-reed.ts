import { scenario, setFact, take, fact, literal, player, bubble } from "@town-zero/shared/script-dsl";

export const farmerReedScenario = scenario("farmer-reed", (s) => {
  s.npc("farmer-reed", {
    name: "Farmer Reed",
    role: "farmer",
    faction: "village-1",
    position: { x: 9, y: 19 },
    initialBeliefs: [],
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

    d.text("haggle", ["The whole village benefits when we have enough food. Please reconsider."], { next: "quest-offer" });

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
