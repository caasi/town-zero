import "../../src/polyfill.js";
import "../../src/encoder-config.js";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DIALOGUE_TIMEOUT_TICKS, FOOD_CONSUMPTION_INTERVAL, IDLE_TIMEOUT_TICKS, JOIN_REFUSED_FULL, REVIVE_DELAY_TICKS, TICK_RATE_MS } from "@town-zero/shared";
import type { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";

// Direct-instantiation approach: test GameRoom lifecycle methods directly
// The pure functions (sync, validation, vision) are fully tested in other files;
// these tests focus on the wiring between Colyseus lifecycle and simulation.

import type { SimulationState } from "../../src/simulation/tick.js";
import { startDialogue, advanceDialogue, chooseDialogue } from "../../src/dialogue/session-manager.js";
import { ReplyController } from "../../src/ai/reply-controller.js";
import { mockClient, createTestRoom, joinClient, leaveClient, sendInput, sendMessage, tick } from "./room-harness.js";

describe("GameRoom integration", () => {
  let room: any;
  let state: WorldStateSchema;

  beforeEach(() => {
    const result = createTestRoom();
    room = result.room;
    state = result.state;
  });

  it("creates with grid dimensions and initial state", () => {
    expect(state.width).toBe(40);
    expect(state.height).toBe(40);
    expect(state.tiles.size).toBe(1600);
    expect(state.tick).toBe(0);
  });

  it("has village and den settlements", () => {
    let villageCount = 0;
    let denCount = 0;
    state.settlements.forEach((s: any) => {
      if (s.type === "village") villageCount++;
      if (s.type === "den") denCount++;
    });
    expect(villageCount).toBeGreaterThan(0);
    expect(denCount).toBeGreaterThan(0);
  });

  it("player joins and agent appears in state after tick", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "TestPlayer" });
    tick(room);

    let playerAgent: any;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    expect(playerAgent).toBeDefined();
    expect(playerAgent.faction).toBe("village-1");
    expect(playerAgent.role).toBe("player");
  });

  describe("player names", () => {
    const playerSchema = () => {
      let found: any;
      state.agents.forEach((agent: any) => { if (agent.controller === "player") found = agent; });
      return found;
    };

    it("keeps the cleaned name from the join and shows it to everyone", () => {
      joinClient(room, mockClient("session-1"), { name: "  Quiet   Otter " });
      tick(room);
      expect(playerSchema().name).toBe("Quiet Otter");
    });

    it("gives a numbered name when the join has none", () => {
      joinClient(room, mockClient("session-1"), {});
      tick(room);
      expect(playerSchema().name).toMatch(/^Player-\d+$/);
    });

    it("renames on a rename message, and ignores a bad one", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Quiet Otter" });
      sendMessage(room, client, "rename", { name: "Solid Heron" });
      tick(room);
      expect(playerSchema().name).toBe("Solid Heron");
      for (const bad of [{ name: "   " }, { name: 42 }, "Solid", null]) {
        sendMessage(room, client, "rename", bad);
      }
      tick(room);
      expect(playerSchema().name).toBe("Solid Heron");
    });

    const names = () => {
      const all: string[] = [];
      state.agents.forEach((agent: any) => { if (agent.controller === "player") all.push(agent.name); });
      return all.sort();
    };

    it("gives a joining player a number when its name is taken", () => {
      joinClient(room, mockClient("session-1"), { name: "Quiet Otter" });
      joinClient(room, mockClient("session-2"), { name: "quiet otter" });
      joinClient(room, mockClient("session-3"), { name: "Quiet Otter" });
      tick(room);
      // Each keeps the case it sent; only the number is added.
      expect(names()).toEqual(["Quiet Otter", "Quiet Otter 3", "quiet otter 2"]);
    });

    it("refuses a rename to another player's or an NPC's name, and says so", () => {
      const a = mockClient("session-1");
      const b = mockClient("session-2");
      joinClient(room, a, { name: "Quiet Otter" });
      joinClient(room, b, { name: "Iron Falcon" });
      for (const taken of ["QUIET OTTER", "Farmer Reed", "innkeeper"]) {
        sendMessage(room, b, "rename", { name: taken });
      }
      tick(room);
      expect(names()).toEqual(["Iron Falcon", "Quiet Otter"]);
      expect(b.messages.filter((m: any) => m.type === "rename:rejected").map((m: any) => m.data))
        .toEqual([{ name: "QUIET OTTER" }, { name: "Farmer Reed" }, { name: "innkeeper" }]);
    });

    it("lets a player change the case of its own name", () => {
      const a = mockClient("session-1");
      joinClient(room, a, { name: "Quiet Otter" });
      sendMessage(room, a, "rename", { name: "quiet otter" });
      tick(room);
      expect(names()).toEqual(["quiet otter"]);
    });

    it("ignores a rename from a session without an agent", () => {
      expect(() => sendMessage(room, mockClient("not-joined"), "rename", { name: "Ghost" })).not.toThrow();
    });
  });

  it("player sends input frame and position updates", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Mover" });
    tick(room);

    let playerAgent: any;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    const origX = playerAgent.x;

    // First input in a new direction only turns (turn-before-move);
    // second input in same direction actually moves.
    sendInput(room, client, { seq: 1, direction: "east" });
    tick(room);
    sendInput(room, client, { seq: 2, direction: "east" });
    tick(room);

    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    expect(playerAgent.x).toBe(origX + 1);
  });

  it("player leaves and agent is removed from world and village", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Leaver" });
    tick(room);

    const joined = client.messages.find((m: any) => m.type === "joined");
    const playerId = joined.data.agentId;
    const village = Array.from(room.simState.settlements.values()).find((s: any) => s.type === "village") as any;
    expect(village.populationIds).toContain(playerId);

    leaveClient(room, client);
    tick(room);

    expect(room.simState.agents.has(playerId)).toBe(false);
    expect(state.agents.has(playerId)).toBe(false);
    expect(village.populationIds).not.toContain(playerId);
  });

  it("repeated join/leave cycles never hit the population cap", () => {
    for (let i = 0; i < 20; i++) {
      const client = mockClient(`session-${i}`);
      joinClient(room, client, { name: `P${i}` });
      expect(client.messages.some((m: any) => m.type === "joined")).toBe(true);
      leaveClient(room, client);
    }
  });

  it("dead agents do not count toward the population cap", () => {
    const village = Array.from(room.simState.settlements.values()).find((s: any) => s.type === "village") as any;
    for (const id of village.populationIds) room.simState.agents.get(id)?.takeDamage(10_000);
    tick(room);

    expect(village.populationIds).toEqual([]);
  });

  it("freezes llm beasts while no player is in the world", () => {
    const beast = room.simState.agents.get("mnpc-0")!;
    beast.removeFromInventory("food", beast.inventory.food);
    for (let i = 0; i < 3; i++) tick(room);
    expect(beast.inventory.food).toBe(0);
    expect(beast.planBacklog).toEqual([]);
  });

  it("drives llm beasts each tick (fallback rules without a Jev key)", () => {
    joinClient(room, mockClient("session-1"), { name: "Watcher" });
    const beast = room.simState.agents.get("mnpc-0")!;
    beast.removeFromInventory("food", beast.inventory.food);
    for (let i = 0; i < 3; i++) tick(room);
    expect(beast.inventory.food).toBeGreaterThan(0); // took food from the den
  });

  describe("pauses Jev while every player is idle", () => {
    // Counts the ticks on which the beasts get a Jev update.
    function jevTicks(n: number): number {
      const update = vi.spyOn(room.jev, "update");
      for (let i = 0; i < n; i++) tick(room);
      const calls = update.mock.calls.length;
      update.mockRestore();
      return calls;
    }

    it("while the only tab is hidden, until it comes back", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      sendMessage(room, client, "presence", { active: false });
      expect(jevTicks(3)).toBe(0);
      sendMessage(room, client, "presence", { active: true });
      expect(jevTicks(3)).toBe(3);
    });

    it("after IDLE_TIMEOUT_TICKS without a message, until the next input", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      expect(jevTicks(IDLE_TIMEOUT_TICKS)).toBe(IDLE_TIMEOUT_TICKS);
      expect(jevTicks(3)).toBe(0);
      sendInput(room, client, { seq: 1, direction: "north" });
      expect(jevTicks(3)).toBe(3);
    });

    it("after IDLE_TIMEOUT_TICKS hidden, until the tab is shown again", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      sendMessage(room, client, "presence", { active: false });
      expect(jevTicks(IDLE_TIMEOUT_TICKS + 1)).toBe(0);
      sendMessage(room, client, "presence", { active: true });
      expect(jevTicks(3)).toBe(3);
    });

    it.each([
      ["revive", undefined],
      ["dialogue:advance", undefined],
      ["dialogue:choose", { optionId: "none" }],
      ["dialogue:close", undefined],
    ])("counts %s as activity", (type, data) => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      jevTicks(IDLE_TIMEOUT_TICKS);
      expect(jevTicks(1)).toBe(0);
      sendMessage(room, client, type, data);
      expect(jevTicks(3)).toBe(3);
    });

    it("and the paused beasts do not starve", () => {
      const beast = room.simState.agents.get("mnpc-0")!;
      beast.removeFromInventory("food", beast.inventory.food);
      const hp = beast.hp;
      for (let i = 0; i < FOOD_CONSUMPTION_INTERVAL * 2; i++) tick(room);
      expect(beast.hp).toBe(hp);
    });

    it("and logs why, once per pause and resume", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      tick(room);
      sendMessage(room, client, "presence", { active: false });
      sendMessage(room, client, "presence", { active: false });
      for (let i = 0; i < 3; i++) tick(room);
      sendMessage(room, client, "presence", { active: true });
      tick(room);
      const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => /^\[(presence|idle)\]/.test(l));
      log.mockRestore();
      expect(lines).toEqual([
        "[presence] player-0 hidden",
        "[idle] Jev paused (hidden 1, idle 0, players 1)",
        "[presence] player-0 visible",
        "[idle] Jev resumed",
      ]);
    });

    it("not while another player is active", () => {
      const away = mockClient("session-1");
      joinClient(room, away, { name: "Away" });
      sendMessage(room, away, "presence", { active: false });
      joinClient(room, mockClient("session-2"), { name: "Here" });
      expect(jevTicks(3)).toBe(3);
    });

    it("ignores presence from a session without an agent", () => {
      sendMessage(room, mockClient("not-joined"), "presence", { active: false });
      expect(room.hiddenSessions.size).toBe(0);
    });

    it("ignores a malformed presence message", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Watcher" });
      sendMessage(room, client, "presence", { active: "no" });
      expect(jevTicks(3)).toBe(3);
    });
  });

  it.each([
    ["abc1234def", "abc1234def"],
    ["", "dev"],
  ])("tells the client which build the server runs (TOWN_ZERO_COMMIT=%j)", (env, commit) => {
    vi.stubEnv("TOWN_ZERO_COMMIT", env);
    try {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Player" });
      const joined = client.messages.find((m: any) => m.type === "joined");
      expect(joined.data.commit).toBe(commit);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sends an NPC's reply line on a later tick (spec 004)", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Player" });
    const agentId = client.messages.find((m: any) => m.type === "joined").data.agentId;
    room.simState.agents.get(agentId)!.position = { x: 11, y: 20 }; // next to the innkeeper
    startDialogue(agentId, "innkeeper", room.simState);
    advanceDialogue(agentId, room.simState); // greeting → menu
    const waiting = chooseDialogue(agentId, "menu_opt_0", room.simState); // "What's the news in Tandi?"
    expect(waiting).toMatchObject({ ok: true, payload: { content: "…" } });

    tick(room); // no key in tests: the first line
    const states = client.messages.filter((m: any) => m.type === "dialogue:state");
    expect(states.at(-1).data.content).toContain("More beasts in the hills every week");
  });

  it("sends a reply line that Jev answers between ticks, and ignores advance while it waits", async () => {
    let answer!: (c: { id: string }) => void;
    room.replies = new ReplyController(() => new Promise((r) => (answer = r)));
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Player" });
    const agentId = client.messages.find((m: any) => m.type === "joined").data.agentId;
    room.simState.agents.get(agentId)!.position = { x: 11, y: 20 };
    startDialogue(agentId, "innkeeper", room.simState);
    advanceDialogue(agentId, room.simState);
    chooseDialogue(agentId, "menu_opt_0", room.simState);
    tick(room); // asks Jev

    answer({ id: "tease" });
    await new Promise((r) => setTimeout(r, 0));
    // Answered, but not sent yet: an advance must not skip the line.
    expect(advanceDialogue(agentId, room.simState)).toMatchObject({ ok: true, payload: { nodeType: "waiting" } });
    tick(room);
    const states = client.messages.filter((m: any) => m.type === "dialogue:state");
    expect(states.at(-1).data.content).toContain("carry a basket");
  });

  it("multiple players join and appear in state", () => {
    const client1 = mockClient("session-1");
    const client2 = mockClient("session-2");
    joinClient(room, client1, { name: "Player1" });
    joinClient(room, client2, { name: "Player2" });
    tick(room);

    let playerCount = 0;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerCount++;
    });
    expect(playerCount).toBe(2);
  });

  it("bot agents exist and are alive after ticks", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Observer" });
    tick(room);
    tick(room);
    tick(room);

    let botCount = 0;
    state.agents.forEach((agent: any) => {
      if (agent.controller !== "player" && agent.hp > 0) botCount++;
    });
    expect(botCount).toBeGreaterThan(0);
  });

  it("settlement shows in state with population and resources", () => {
    tick(room);

    let village: any;
    state.settlements.forEach((s: any) => {
      if (s.type === "village") village = s;
    });
    expect(village).toBeDefined();
    expect(village.population).toBeGreaterThan(0);
    expect(village.inventory.get("food")).toBeGreaterThanOrEqual(0);
  });

  it("invalid input is ignored without crash", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "BadCmd" });
    tick(room);

    sendInput(room, client, { seq: 1, action: { type: "fly" } });
    tick(room);

    expect(state.tick).toBeGreaterThan(0);
  });

  it("rejects seq=0 from client (reserved for bot/planBacklog)", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Spoofer" });
    tick(room);

    const agentId = client.messages.find((m: any) => m.type === "joined")?.data.agentId;
    const simAgent = room.simState.agents.get(agentId!);

    // Client sends seq=0 — should be silently rejected
    sendInput(room, client, { seq: 0, direction: "south" });
    expect(simAgent.inputQueue).toEqual([]);
  });

  it("malformed input (bad shape) is ignored", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "BadShape" });
    tick(room);

    sendInput(room, client, "not an object");
    sendInput(room, client, null);
    sendInput(room, client, { seq: -1, direction: "north" }); // invalid seq
    tick(room);

    expect(state.tick).toBeGreaterThan(0);
  });

  it("sends vision updates to connected players", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Visionary" });
    tick(room);

    const visionMsgs = client.messages.filter((m: any) => m.type === "vision");
    expect(visionMsgs.length).toBeGreaterThan(0);
    expect(visionMsgs[0].data.tick).toBeGreaterThan(0);
    expect(visionMsgs[0].data.tiles).toBeDefined();
  });

  it("sends death notification when player agent dies", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Doomed" });
    tick(room);

    // Kill the agent directly via sim state
    let agentId: string | undefined;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") agentId = agent.id;
    });
    const simAgent = room.simState.agents.get(agentId!);
    simAgent.takeDamage(200);

    tick(room);

    const deathMsgs = client.messages.filter((m: any) => m.type === "death");
    expect(deathMsgs.length).toBeGreaterThan(0);
    expect(deathMsgs[0].data.agentId).toBe(agentId);
  });

  describe("revive", () => {
    function joinAndKill() {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Doomed" });
      tick(room);
      const agentId = client.messages.find((m: any) => m.type === "joined").data.agentId;
      const agent = room.simState.agents.get(agentId);
      agent.addToInventory("material", 2);
      agent.position = { x: 25, y: 20 }; // away from the village
      agent.takeDamage(200);
      tick(room);
      return { client, agentId, agent };
    }

    it("death message says when revive is allowed, and is sent once", () => {
      const { client } = joinAndKill();
      tick(room);
      const deaths = client.messages.filter((m: any) => m.type === "death");
      expect(deaths).toHaveLength(1);
      expect(deaths[0].data.reviveInMs).toBe(REVIVE_DELAY_TICKS * TICK_RATE_MS);
    });

    it("rejects revive before the delay", () => {
      const { client, agent } = joinAndKill();
      sendMessage(room, client, "revive");
      expect(agent.isAlive()).toBe(false);
    });

    it("revives the same agent in the village with full HP, keeping its inventory", () => {
      const { client, agentId, agent } = joinAndKill();
      for (let i = 0; i < REVIVE_DELAY_TICKS; i++) tick(room);
      sendMessage(room, client, "revive");

      expect(room.simState.agents.get(agentId)).toBe(agent);
      expect(agent.isAlive()).toBe(true);
      expect(agent.hp).toBe(agent.maxHp);
      expect(agent.inventory.material).toBe(2);
      const village = Array.from(room.simState.settlements.values()).find((s: any) => s.type === "village") as any;
      expect(village.isInTerritory(agent.position)).toBe(true);
      expect(village.populationIds).toContain(agentId);
      expect(client.messages.some((m: any) => m.type === "revived")).toBe(true);

      // Input works again.
      sendInput(room, client, { seq: 1, direction: "north" });
      tick(room);
      expect(agent.facing).toBe("north");
    });
  });

  it("a dead player keeps its village slot, so revive works when the village fills up", () => {
    const c0 = mockClient("s0");
    joinClient(room, c0, { name: "Dead" });
    tick(room);
    const id = c0.messages.find((m: any) => m.type === "joined").data.agentId;
    room.simState.agents.get(id).takeDamage(500);
    tick(room);
    for (let i = 0; i < 10; i++) joinClient(room, mockClient("x" + i), { name: "F" + i });
    for (let i = 0; i < REVIVE_DELAY_TICKS; i++) tick(room);

    sendMessage(room, c0, "revive");
    expect(room.simState.agents.get(id).isAlive()).toBe(true);
    const village = Array.from(room.simState.settlements.values()).find((s: any) => s.type === "village") as any;
    expect(village.populationIds.filter((p: string) => p === id)).toHaveLength(1);
    expect(village.populationIds.length).toBeLessThanOrEqual(village.getPopulationCap());
  });

  it("acknowledges moves dropped by death, so the client does not replay them after revive", () => {
    const client = mockClient("s-dead");
    joinClient(room, client, { name: "Doomed" });
    tick(room);
    const id = client.messages.find((m: any) => m.type === "joined").data.agentId;
    const agent = room.simState.agents.get(id);
    sendInput(room, client, { seq: 1, direction: "west" });   // queued when death comes
    agent.takeDamage(500);
    expect(agent.lastProcessedInput).toBe(1);                 // death acknowledged the queued frame
    sendInput(room, client, { seq: 2, direction: "west" });   // in flight, arrives while dead
    expect(agent.lastProcessedInput).toBe(2);
  });

  it("ignores commands from dead agents", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "DeadPlayer" });
    tick(room);

    let agentId: string | undefined;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") agentId = agent.id;
    });

    const simAgent = room.simState.agents.get(agentId!);
    const origX = simAgent.position.x;
    simAgent.takeDamage(200);
    tick(room);

    // Try to move after death — should be silently ignored
    sendInput(room, client, { seq: 1, direction: "east" });
    tick(room);

    expect(state.agents.get(agentId!)!.hp).toBe(0);
  });

  it("rejects player when village is at population cap", () => {
    // Fill village to capacity
    const village = Array.from((room.simState as SimulationState).settlements.values())
      .find((s) => s.type === "village")!;
    const cap = village.getPopulationCap();
    const existingPop = village.populationIds.length;
    const spotsLeft = cap - existingPop;

    // Fill remaining spots
    const fillers: any[] = [];
    for (let i = 0; i < spotsLeft; i++) {
      const c = mockClient(`filler-${i}`);
      joinClient(room, c, { name: `Filler-${i}` });
      fillers.push(c);
    }
    expect(village.populationIds.length).toBe(cap);

    // Next join should be rejected
    const rejected = mockClient("rejected");
    const leaveSpy = { called: false, code: 0, reason: "" };
    rejected.leave = (code: number, reason: string) => {
      leaveSpy.called = true;
      leaveSpy.code = code;
      leaveSpy.reason = reason;
    };
    joinClient(room, rejected, { name: "TooMany" });

    expect(leaveSpy.called).toBe(true);
    expect(leaveSpy.code).toBe(JOIN_REFUSED_FULL);
    expect(leaveSpy.reason).toBe("Village is full");
    expect(village.populationIds.length).toBe(cap);
  });

  it("sends joined message with agentId on join", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Joiner" });

    const joinedMsgs = client.messages.filter((m: any) => m.type === "joined");
    expect(joinedMsgs).toHaveLength(1);
    expect(joinedMsgs[0].data.agentId).toMatch(/^player-/);
  });

  describe("dialogue integration", () => {
    function setupDialogue(room: any) {
      const client = mockClient("session-dlg");
      joinClient(room, client, { name: "Talker" });
      tick(room);

      // Move player adjacent to Farmer Reed (at 9,19)
      const agentId = client.messages.find((m: any) => m.type === "joined")?.data.agentId;
      const simAgent = room.simState.agents.get(agentId!);
      simAgent.position = { x: 9, y: 18 }; // north of Reed
      simAgent.state = "idle";

      return { client, agentId };
    }

    it("acknowledges moves queued behind a talk frame instead of dropping them", () => {
      // The client predicted those moves; a frame that is neither run nor
      // acknowledged stays in its pending buffer and is replayed in dialogue.
      const { client, agentId } = setupDialogue(room);
      const agent = room.simState.agents.get(agentId!);
      agent.facing = "south";
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      sendInput(room, client, { seq: 2, direction: "west" });
      tick(room);
      tick(room);
      expect(agent.talkingToNpcId).toBe("farmer-reed");
      expect(agent.lastProcessedInput).toBe(2);
      expect(agent.position).toEqual({ x: 9, y: 18 }); // locked: acknowledged, not moved
    });

    it("talk command creates session and sends dialogue:state", () => {
      const { client, agentId } = setupDialogue(room);

      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      const dlgMsgs = client.messages.filter((m: any) => m.type === "dialogue:state");
      expect(dlgMsgs).toHaveLength(1);
      expect(dlgMsgs[0].data.npcId).toBe("farmer-reed");
      expect(dlgMsgs[0].data.nodeType).toBe("text");

      // Player should have dialogue lock
      const simAgent = room.simState.agents.get(agentId!);
      expect(simAgent.talkingToNpcId).toBe("farmer-reed");
    });

    it("a player who dies in dialogue is released and can act after revive", () => {
      const { client, agentId } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);
      const agent = room.simState.agents.get(agentId!);
      agent.takeDamage(500);
      tick(room);
      expect(agent.talkingToNpcId).toBeNull();
      expect(room.simState.agents.get("farmer-reed").currentTalkingTo).toBeNull();

      for (let i = 0; i < REVIVE_DELAY_TICKS; i++) tick(room);
      sendMessage(room, client, "revive");
      const turnTo = agent.facing === "north" ? "south" : "north";
      sendInput(room, client, { seq: 2, direction: turnTo });
      tick(room);
      expect(agent.facing).toBe(turnTo);
    });

    it("dialogue:advance sends updated state", () => {
      const { client } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      sendMessage(room, client, "dialogue:advance");

      const dlgMsgs = client.messages.filter((m: any) => m.type === "dialogue:state");
      expect(dlgMsgs).toHaveLength(2); // initial + advance
      expect(dlgMsgs[1].data.nodeType).toBe("choice");
    });

    it("dialogue:choose sends updated state", () => {
      const { client } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);
      sendMessage(room, client, "dialogue:advance"); // → choice

      const choiceMsgs = client.messages.filter((m: any) => m.type === "dialogue:state");
      const lastChoice = choiceMsgs[choiceMsgs.length - 1];
      const refuseOpt = lastChoice.data.options.find((o: any) =>
        o.label.toLowerCase().includes("not right now"),
      );
      expect(refuseOpt).toBeDefined();

      sendMessage(room, client, "dialogue:choose", { optionId: refuseOpt.id });

      const afterChoose = client.messages.filter((m: any) => m.type === "dialogue:state");
      // Should have advanced to refuse text
      expect(afterChoose.length).toBeGreaterThan(choiceMsgs.length);
    });

    it("dialogue:close sends dialogue:end", () => {
      const { client, agentId } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      sendMessage(room, client, "dialogue:close");

      const endMsgs = client.messages.filter((m: any) => m.type === "dialogue:end");
      expect(endMsgs).toHaveLength(1);

      // Agent should be back to idle
      const simAgent = room.simState.agents.get(agentId!);
      expect(simAgent.state).toBe("idle");
    });

    it("player in dialogue rejects movement input", () => {
      const { client, agentId } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      const simAgent = room.simState.agents.get(agentId!);
      const origX = simAgent.position.x;

      // Try to move while in dialogue — executeFrame rejects due to dialogue lock
      sendInput(room, client, { seq: 2, direction: "east" });
      tick(room);

      expect(simAgent.position.x).toBe(origX);
    });

    it("sends dialogue:error when startDialogue fails", () => {
      // First player starts dialogue with Reed
      const { client: client1 } = setupDialogue(room);
      sendInput(room, client1, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      // Second player tries to talk to Reed (who is busy)
      const client2 = mockClient("session-dlg2");
      joinClient(room, client2, { name: "Talker2" });
      tick(room);
      const agentId2 = client2.messages.find((m: any) => m.type === "joined")?.data.agentId;
      const simAgent2 = room.simState.agents.get(agentId2!);
      simAgent2.position = { x: 9, y: 18 };
      simAgent2.facing = "south";

      sendInput(room, client2, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      const errMsgs = client2.messages.filter((m: any) => m.type === "dialogue:error");
      expect(errMsgs).toHaveLength(1);
      expect(errMsgs[0].data.error).toBe("busy");
    });

    it("timeout sends dialogue:end", () => {
      const { client } = setupDialogue(room);
      sendInput(room, client, { seq: 1, action: { type: "talk", targetId: "farmer-reed" } });
      tick(room);

      // Fast-forward ticks past timeout (DIALOGUE_TIMEOUT_TICKS + 1)
      for (let i = 0; i <= DIALOGUE_TIMEOUT_TICKS; i++) {
        tick(room);
      }

      const endMsgs = client.messages.filter((m: any) => m.type === "dialogue:end");
      expect(endMsgs).toHaveLength(1);
      expect(endMsgs[0].data.reason).toBe("timeout");
    });
  });

  describe("key release", () => {
    // The client predicts every move it sends. A key release must not drop
    // moves the server has queued but not run yet, or the player is pulled
    // back. A legacy "input:stop" from an old tab must be accepted and ignored.
    it("runs every move sent before the release", () => {
      const client = mockClient("session-1");
      joinClient(room, client, { name: "Walker" });
      tick(room);
      const agentId = client.messages.find((m: any) => m.type === "joined")?.data.agentId;
      const agent = room.simState.agents.get(agentId!);
      agent.facing = "south";
      const startY = agent.position.y;

      sendInput(room, client, { seq: 1, direction: "south" });
      sendInput(room, client, { seq: 2, direction: "south" });
      expect(room._messageHandlers.has("input:stop")).toBe(true); // unregistered types disconnect
      sendMessage(room, client, "input:stop", { seq: 2 });
      expect(agent.lastProcessedInput).toBe(0); // nothing acknowledged before it runs

      tick(room);
      tick(room);
      expect(agent.position.y).toBe(startY + 2);
      expect(agent.lastProcessedInput).toBe(2);
    });
  });

  it("two players attack pipeline works", () => {
    const client1 = mockClient("session-1");
    const client2 = mockClient("session-2");
    joinClient(room, client1, { name: "Attacker" });
    joinClient(room, client2, { name: "Defender" });
    tick(room);

    const attackerId = client1.messages.find((m: any) => m.type === "joined")?.data.agentId;
    const defenderId = client2.messages.find((m: any) => m.type === "joined")?.data.agentId;
    expect(attackerId).toBeDefined();
    expect(defenderId).toBeDefined();

    sendInput(room, client1, { seq: 1, action: { type: "attack", targetId: defenderId } });
    tick(room);
    tick(room);

    expect(state.tick).toBeGreaterThan(0);
  });
});
