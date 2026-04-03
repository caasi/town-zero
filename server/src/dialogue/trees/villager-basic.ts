import { scenario, t } from "@town-zero/shared/script-dsl";

export const villagerBasicScenario = scenario("villager-basic", (s) => {
  s.npc("villager", {
    role: "farmer",
    faction: "village",
    position: { x: 0, y: 0 },
    initialBeliefs: [],
  });

  s.dialogue("villager", "villager-basic", (d) => {
    d.text("greeting", t`Hello, what can I do for you?`, {
      next: "main-choices",
    });

    d.choice("main-choices", [
      d.option("How is the village doing?").goto("village-status"),
      d.option("Can you scout the north?").goto("scout-request"),
      d.option("Can you gather food?").goto("gather-request"),
      d.option("Never mind.").goto("farewell"),
    ]);

    d.text("village-status", t`We're managing, but food supplies are getting low.`, {
      next: "main-choices",
    });

    d.request("scout-request", t`Scout the northern area`, {
      nextYes: "scout-yes",
      nextNo: "scout-no",
    });
    d.text("scout-yes", t`Alright, I'll head north and report back.`, {
      next: "farewell",
    });
    d.text("scout-no", t`I can't right now, I have other duties.`, {
      next: "main-choices",
    });

    d.request("gather-request", t`Go gather food for the village`, {
      nextYes: "gather-yes",
      nextNo: "gather-no",
    });
    d.text("gather-yes", t`Sure, I'll head to the fields.`, {
      next: "farewell",
    });
    d.text("gather-no", t`I need to rest first, maybe later.`, {
      next: "main-choices",
    });

    d.text("farewell", t`Take care out there.`, { next: "done" });
    d.end("done");
  });
});
