import { describe, it, expect } from "vitest";
import { DialogueSession } from "../../src/dialogue/dialogue-session.js";
import { Agent } from "../../src/simulation/agent.js";
import type { DialogueTreeData } from "@town-zero/shared";
import { scenario, fact } from "@town-zero/shared/script-dsl";

function makeAgents() {
  const npc = new Agent({ id: "reed", position: { x: 5, y: 5 }, faction: "v", role: "farmer", controller: "bot" });
  const player = new Agent({ id: "player-0", position: { x: 5, y: 6 }, faction: "v", role: "player", controller: "player" });
  return { npc, player };
}

// The player asks; Reed answers with a line that Jev picks.
const tree: DialogueTreeData = {
  id: "ask",
  root: "ask",
  nodes: {
    ask: { type: "choice", options: [{ id: "ask_opt_0", label: ["What's in it for me?"], next: "answer" }] },
    answer: {
      type: "reply",
      lines: [
        { id: "calm", description: "Explain calmly.", text: ["The village needs it."], next: "end" },
        { id: "curt", description: "Answer curtly.", text: ["Help or leave."], next: "end" },
        { id: "reward", description: "Offer a reward.", text: ["Take some bread."], next: "end",
          condition: { type: "fact_ref", key: "has_bread" } },
      ],
    },
    end: { type: "end" },
  },
};

function atReply() {
  const { npc, player } = makeAgents();
  const session = new DialogueSession({ tree, npc, player, currentTick: 0 });
  session.select("ask_opt_0");
  return { session, npc, player };
}

describe("reply node", () => {
  it("waits for a pick and shows a thinking text", () => {
    const { session } = atReply();
    expect(session.isWaiting()).toBe(true);
    expect(session.getState()).toMatchObject({ type: "waiting", text: "…" });
  });

  it("asks once, with the lines whose condition holds and the player's line", () => {
    const { session } = atReply();
    expect(session.takeReplyRequest()).toEqual({
      playerLine: "What's in it for me?",
      lines: [
        { id: "calm", description: "Explain calmly." },
        { id: "curt", description: "Answer curtly." },
      ],
    });
    expect(session.takeReplyRequest()).toBeNull();
  });

  it("shows the picked line, then goes to its next node", () => {
    const { session } = atReply();
    session.takeReplyRequest();
    expect(session.answerReply("curt")).toBe(true);
    expect(session.isWaiting()).toBe(false);
    expect(session.getState()).toMatchObject({ type: "text", speaker: "npc", text: "Help or leave." });
    session.advance();
    expect(session.isEnded()).toBe(true);
  });

  it("uses the first line for an id that was not offered", () => {
    const { session } = atReply();
    session.takeReplyRequest();
    session.answerReply("reward"); // its condition is false
    expect(session.getState()).toMatchObject({ text: "The village needs it." });
  });

  it("does not wait when only the first line is left", () => {
    const oneLine: DialogueTreeData = {
      ...tree,
      nodes: {
        ...tree.nodes,
        answer: {
          type: "reply",
          lines: [
            { id: "calm", description: "Explain calmly.", text: ["The village needs it."], next: "end" },
            { id: "reward", description: "Offer a reward.", text: ["Take some bread."], next: "end",
              condition: { type: "fact_ref", key: "has_bread" } },
          ],
        },
      },
    };
    const { npc, player } = makeAgents();
    const session = new DialogueSession({ tree: oneLine, npc, player, currentTick: 0 });
    session.select("ask_opt_0");
    expect(session.isWaiting()).toBe(false);
    expect(session.takeReplyRequest()).toBeNull();
    expect(session.getState()).toMatchObject({ type: "text", text: "The village needs it." });
  });

  it("drops an answer that arrives after the session ended", () => {
    const { session } = atReply();
    session.takeReplyRequest();
    session.dispose();
    expect(session.answerReply("curt")).toBe(false);
  });

  it("ignores advance while it waits", () => {
    const { session } = atReply();
    expect(session.advance()).toMatchObject({ type: "waiting" });
    expect(session.isWaiting()).toBe(true);
  });
});

describe("reply builder", () => {
  it("builds lines with ids, descriptions, texts, conditions and targets", () => {
    const data = scenario("t", (s) => {
      s.npc("reed", { role: "farmer", faction: "v", position: { x: 0, y: 0 }, initialBeliefs: [], gender: { kind: "male" }, personality: "Dutiful." });
      s.dialogue("reed", "d", (d) => {
        d.reply("answer", [
          d.line("calm", "Explain calmly.", "The village needs it.").goto("end"),
          d.line("reward", "Offer a reward.", "Take some bread.").when(fact("has_bread").eq(true)).goto("end"),
        ]);
        d.end("end");
      });
    });
    const node = data.dialogues[0].nodes.answer;
    expect(node.type).toBe("reply");
    if (node.type !== "reply") return;
    expect(node.lines.map((l) => [l.id, l.description, l.text, l.next])).toEqual([
      ["calm", "Explain calmly.", ["The village needs it."], "end"],
      ["reward", "Offer a reward.", ["Take some bread."], "end"],
    ]);
    expect(node.lines[1].condition).toBeDefined();
  });

  it("refuses a condition on the first line, which is the fallback", () => {
    expect(() => scenario("t", (s) => {
      s.npc("reed", { role: "farmer", faction: "v", position: { x: 0, y: 0 }, initialBeliefs: [], gender: { kind: "male" }, personality: "Dutiful." });
      s.dialogue("reed", "d", (d) => {
        d.reply("answer", [
          d.line("reward", "Offer a reward.", "Take some bread.").when(fact("has_bread").eq(true)).goto("end"),
          d.line("calm", "Explain calmly.", "The village needs it.").goto("end"),
        ]);
        d.end("end");
      });
    })).toThrow(/first line/);
  });
});
