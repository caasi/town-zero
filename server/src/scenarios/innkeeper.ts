import { scenario, literal } from "@town-zero/shared/script-dsl";

// Tandi's innkeeper (docs/story.md): grumpy, talks, gives no quest. Her
// replies show her personality; Jev picks them (spec 004). Only facts that
// docs/story.md lists as agreed go into her lines.
export const innkeeperScenario = scenario("innkeeper", (s) => {
  s.npc("innkeeper", {
    name: "Innkeeper",
    role: "innkeeper",
    faction: "village-1",
    position: { x: 11, y: 21 },
    initialBeliefs: [],
    gender: { kind: "female" },
    // Checked with real Jev calls (spec 004): "cares about the village"
    // pulled her to the neutral lines, the same as Reed; "complains about
    // everything" makes her pick the grumbling ones.
    personality: "She is grumpy and sharp-tongued, and she complains about everything. She shows her kindness only in what she does, never in what she says.",
    farewells: ["Staring won't fill your bowl. Off you go."],
  });

  s.dialogue("innkeeper", "innkeeper-dialogue", (d) => {
    d.text("greeting", ["Hmph. Another traveler. The soup is cold and the beds are full. What do you want?"], { next: "menu" });

    d.choice("menu", [
      d.option("What's the news in Tandi?").goto("news"),
      d.option("Why are there so many monsters?").goto("monsters"),
      d.option("Nothing. Goodbye.").goto("bye"),
    ]);

    // The first line of each reply is the neutral fallback. The two grumbling
    // lines fit her personality in two situations, so the storehouse decides
    // between them (real runs: almost empty → "grumble-hungry", full →
    // "grumble-full").
    d.reply("news", [
      d.line("plain", "Give the news plainly: more monsters come near the village.",
        "More beasts in the hills every week. That's the news.").goto("menu"),
      d.line("grumble-hungry", "Complain loudly that the storehouse is almost empty and everyone is hungry and cross.",
        "The storehouse is nearly empty, everyone's hungry, and hungry people complain. To me. All day.").goto("menu"),
      d.line("grumble-full", "Complain that even with a full storehouse, nobody stops worrying about the monsters.",
        "The storehouse is full for once, and still everyone frets about the beasts. There's no pleasing this village.").goto("menu"),
      d.line("tease", "Tease the traveler for asking for news instead of helping.",
        "News is for people who sit around. You look like you can carry a basket. Go and ask Reed.").goto("menu"),
    ]);

    d.reply("monsters", [
      d.line("honest", "Say honestly that nobody knows why there are more monsters now.",
        "Nobody knows. They're not like any animal I've seen, and I've seen plenty.").goto("menu"),
      d.line("not-my-job", "Grumble that it is not an innkeeper's job to know.",
        "Do I look like a scholar? I pour soup. Ask the beasts yourself.").goto("menu"),
      d.line("warn", "Warn the traveler, gruffly, not to go near the monsters' den alone.",
        "Don't go poking at their den alone. I'm not cleaning up after another fool.").goto("menu"),
    ]);

    d.text("bye", ["Mind the door on your way out."], { next: "done" });
    d.end("done");

    // No quest, but talking needs an entry: without one, interact is a noop
    // for a same-faction agent.
    d.entry("greeting", literal(true));
  });
});
