import { describe, it, expect } from "vitest";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { startDialogue, endDialogue, tickDialogues } from "../../src/dialogue/session-manager.js";
import type { SimulationState } from "../../src/simulation/tick.js";
import type { EventHandler, TalkStartPayload, TalkEndPayload } from "@town-zero/shared/script-dsl";
import type { DialogueTreeData } from "@town-zero/shared";

function trivialTree(npcId: string): DialogueTreeData {
  return { id: npcId, root: "n1", nodes: { n1: { type: "text", speaker: "npc", content: ["hi"], next: "n2" }, n2: { type: "end" } }, triggers: [] };
}

function buildState(npcId: string): SimulationState {
  const state: SimulationState = {
    grid: new Grid(8, 8), agents: new Map(), settlements: new Map(), tick: 0,
    nextMerchantId: 0, activeSessions: new Map(),
    dialogueTrees: new Map([[npcId, trivialTree(npcId)]]),
  };
  return state;
}

describe("session-manager — talk events", () => {
  it("dispatches talk:start on successful startDialogue", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc);
    state.agents.set("p1", player);

    const events: TalkStartPayload[] = [];
    const h: EventHandler<TalkStartPayload> = (p) => { events.push(p); return []; };
    npc.eventHandlers.set("talk:start", [h as EventHandler<unknown>]);

    startDialogue("p1", "n1", state);
    expect(events).toHaveLength(1);
    expect(events[0].dialogueId).toBe("n1");
    expect(events[0].player.id).toBe("p1");
  });

  it("dispatches talk:end with reason=\"timeout\" on tickDialogues expiry", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc); state.agents.set("p1", player);
    const ends: TalkEndPayload[] = [];
    npc.eventHandlers.set("talk:end", [((p: TalkEndPayload) => { ends.push(p); return []; }) as EventHandler<unknown>]);

    startDialogue("p1", "n1", state);
    state.tick += 10_000;
    tickDialogues(state);
    expect(ends).toHaveLength(1);
    expect(ends[0].reason).toBe("timeout");
  });

  it("dispatches talk:end with reason=\"player_left\" when endDialogue called with that reason", () => {
    const state = buildState("n1");
    const npc = new Agent({ id: "n1", position: { x: 0, y: 0 }, faction: "f", role: "villager", controller: "bot" });
    const player = new Agent({ id: "p1", position: { x: 1, y: 0 }, faction: "player", role: "player", controller: "player" });
    state.agents.set("n1", npc); state.agents.set("p1", player);
    const ends: TalkEndPayload[] = [];
    npc.eventHandlers.set("talk:end", [((p: TalkEndPayload) => { ends.push(p); return []; }) as EventHandler<unknown>]);

    startDialogue("p1", "n1", state);
    endDialogue("n1", state, "player_left");
    expect(ends).toHaveLength(1);
    expect(ends[0].reason).toBe("player_left");
  });
});
