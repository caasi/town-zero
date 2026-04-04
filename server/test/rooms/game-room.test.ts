import "../../src/polyfill.js";
import "../../src/encoder-config.js";

import { describe, it, expect, beforeEach } from "vitest";
import { GameRoom } from "../../src/rooms/GameRoom.js";
import type { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";

// Direct-instantiation approach: test GameRoom lifecycle methods directly
// The pure functions (sync, validation, vision) are fully tested in other files;
// these tests focus on the wiring between Colyseus lifecycle and simulation.

// Minimal mock Client
function mockClient(sessionId: string): any {
  const messages: Array<{ type: string; data: any }> = [];
  return {
    sessionId,
    messages,
    send(type: string, data: any) { messages.push({ type, data }); },
    leave(_code?: number, _reason?: string) {},
  };
}

// Create a GameRoom and call onCreate, bypassing Colyseus server infrastructure
function createTestRoom(): { room: GameRoom; state: WorldStateSchema } {
  const room = Object.create(GameRoom.prototype) as any;

  // Initialize class fields that Object.create skips
  room.sessionToAgent = new Map<string, string>();
  room.nextPlayerId = 0;

  // Minimal Room internals that GameRoom needs
  room.clients = {
    _items: new Map<string, any>(),
    getById(id: string) { return room.clients._items.get(id); },
  };
  room._messageHandlers = new Map();
  room.onMessage = function (type: string, handler: (client: any, data: any) => void) {
    room._messageHandlers.set(type, handler);
  };
  room.setState = function (state: any) { room.state = state; };
  room.setSimulationInterval = function (fn: () => void, _interval: number) {
    room._tickFn = fn;
  };
  room.clock = {
    setInterval(_fn: () => void, _interval: number) {},
  };
  room.broadcast = function () {};

  // Call onCreate
  room.onCreate();

  return { room, state: room.state as WorldStateSchema };
}

function joinClient(room: any, client: any, options?: { name?: string }) {
  room.clients._items.set(client.sessionId, client);
  room.onJoin(client, options);
}

function leaveClient(room: any, client: any) {
  room.onLeave(client);
  room.clients._items.delete(client.sessionId);
}

function sendCommand(room: any, client: any, cmd: unknown) {
  const handler = room._messageHandlers.get("command");
  if (handler) handler(client, cmd);
}

function sendMessage(room: any, client: any, type: string, data?: unknown) {
  const handler = room._messageHandlers.get(type);
  if (handler) handler(client, data);
}

function tick(room: any) {
  room._tickFn();
}

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

  it("player sends move command and position updates", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Mover" });
    tick(room);

    let playerAgent: any;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    const origX = playerAgent.x;
    const origY = playerAgent.y;

    // First move in a new direction only turns (turn-before-move);
    // second move in same direction actually moves.
    sendCommand(room, client, { type: "move", target: { x: origX + 1, y: origY } });
    tick(room);
    sendCommand(room, client, { type: "move", target: { x: origX + 1, y: origY } });
    tick(room);

    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerAgent = agent;
    });
    expect(playerAgent.x).toBe(origX + 1);
  });

  it("player leaves and agent becomes bot-controlled", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "Leaver" });
    tick(room);

    let playerId: string | undefined;
    state.agents.forEach((agent: any) => {
      if (agent.controller === "player") playerId = agent.id;
    });
    expect(playerId).toBeDefined();

    leaveClient(room, client);
    tick(room);

    let leftAgent: any;
    state.agents.forEach((agent: any) => {
      if (agent.id === playerId) leftAgent = agent;
    });
    expect(leftAgent).toBeDefined();
    expect(leftAgent.controller).toBe("bot");
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

  it("invalid command is ignored without crash", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "BadCmd" });
    tick(room);

    sendCommand(room, client, { type: "fly", destination: "moon" });
    tick(room);

    expect(state.tick).toBeGreaterThan(0);
  });

  it("malformed command (bad shape) is ignored", () => {
    const client = mockClient("session-1");
    joinClient(room, client, { name: "BadShape" });
    tick(room);

    sendCommand(room, client, "not an object");
    sendCommand(room, client, null);
    sendCommand(room, client, { type: "move" }); // missing target
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
    sendCommand(room, client, { type: "move", target: { x: origX + 5, y: 5 } });
    tick(room);

    expect(state.agents.get(agentId!)!.hp).toBe(0);
  });

  it("rejects player when village is at population cap", () => {
    // Fill village to capacity
    const village = Array.from(room.simState.settlements.values())
      .find((s: any) => s.type === "village")!;
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
    expect(leaveSpy.code).toBe(4001);
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

    it("talk command creates session and sends dialogue:state", () => {
      const { client, agentId } = setupDialogue(room);

      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });

      const dlgMsgs = client.messages.filter((m: any) => m.type === "dialogue:state");
      expect(dlgMsgs).toHaveLength(1);
      expect(dlgMsgs[0].data.npcId).toBe("farmer-reed");
      expect(dlgMsgs[0].data.nodeType).toBe("text");

      // Player should be in talking state
      const simAgent = room.simState.agents.get(agentId!);
      expect(simAgent.state).toBe("talking");
    });

    it("dialogue:advance sends updated state", () => {
      const { client } = setupDialogue(room);
      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });

      sendMessage(room, client, "dialogue:advance");

      const dlgMsgs = client.messages.filter((m: any) => m.type === "dialogue:state");
      expect(dlgMsgs).toHaveLength(2); // initial + advance
      expect(dlgMsgs[1].data.nodeType).toBe("choice");
    });

    it("dialogue:choose sends updated state", () => {
      const { client } = setupDialogue(room);
      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });
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
      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });

      sendMessage(room, client, "dialogue:close");

      const endMsgs = client.messages.filter((m: any) => m.type === "dialogue:end");
      expect(endMsgs).toHaveLength(1);

      // Agent should be back to idle
      const simAgent = room.simState.agents.get(agentId!);
      expect(simAgent.state).toBe("idle");
    });

    it("player in talking state rejects movement commands", () => {
      const { client, agentId } = setupDialogue(room);
      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });

      const simAgent = room.simState.agents.get(agentId!);
      const origX = simAgent.position.x;
      const origY = simAgent.position.y;

      // Try to move while talking
      sendCommand(room, client, { type: "move", target: { x: origX + 1, y: origY } });
      tick(room);

      // Should not have moved — agent.state is "talking" so idle check fails
      expect(simAgent.position.x).toBe(origX);
    });

    it("timeout sends dialogue:end", () => {
      const { client } = setupDialogue(room);
      sendCommand(room, client, { type: "talk", targetId: "farmer-reed" });

      // Fast-forward ticks past timeout
      for (let i = 0; i < 31; i++) {
        tick(room);
      }

      const endMsgs = client.messages.filter((m: any) => m.type === "dialogue:end");
      expect(endMsgs).toHaveLength(1);
      expect(endMsgs[0].data.reason).toBe("timeout");
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

    sendCommand(room, client1, { type: "attack", targetId: defenderId });
    tick(room);
    tick(room);

    expect(state.tick).toBeGreaterThan(0);
  });
});
