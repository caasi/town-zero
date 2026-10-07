// Drives a GameRoom without the Colyseus server: onCreate runs on an object
// made with Object.create, and messages and ticks are called by hand.
import "../../src/polyfill.js";
import "../../src/encoder-config.js";

import { GameRoom } from "../../src/rooms/GameRoom.js";
import type { WorldStateSchema } from "../../src/rooms/schemas/WorldStateSchema.js";

// Minimal mock Client
export function mockClient(sessionId: string): any {
  const messages: Array<{ type: string; data: any }> = [];
  return {
    sessionId,
    messages,
    send(type: string, data: any) { messages.push({ type, data }); },
    leave(_code?: number, _reason?: string) {},
  };
}

// Create a GameRoom and call onCreate, bypassing Colyseus server infrastructure
export function createTestRoom(): { room: GameRoom; state: WorldStateSchema } {
  const room = Object.create(GameRoom.prototype) as any;

  // Initialize class fields that Object.create skips
  room.sessionToAgent = new Map<string, string>();
  room.nextPlayerId = 0;
  room.reviveAt = new Map<string, number>();
  room.respawnAt = new Map<string, number>();
  room.lastMessageTick = new Map<string, number>();
  room.hiddenSessions = new Set<string>();
  room.jevPaused = false;

  // Minimal Room internals that GameRoom needs
  room.clients = {
    _items: new Map<string, any>(),
    getById(id: string) { return room.clients._items.get(id); },
  };
  room._messageHandlers = new Map();
  room.onMessage = function (type: string, handler: (client: any, data: any) => void) {
    room._messageHandlers.set(type, handler);
  };
  room.setSimulationInterval = function (fn: () => void, _interval: number) {
    room._tickFn = fn;
  };
  room.broadcast = function () {};

  // Call onCreate
  room.onCreate();

  return { room, state: room.state as WorldStateSchema };
}

export function joinClient(room: any, client: any, options?: { name?: string }) {
  room.clients._items.set(client.sessionId, client);
  room.onJoin(client, options);
}

export function leaveClient(room: any, client: any) {
  room.onLeave(client);
  room.clients._items.delete(client.sessionId);
}

export function sendInput(room: any, client: any, frame: unknown) {
  const handler = room._messageHandlers.get("input");
  if (handler) handler(client, frame);
}

export function sendMessage(room: any, client: any, type: string, data?: unknown) {
  const handler = room._messageHandlers.get(type);
  if (handler) handler(client, data);
}

export function tick(room: any) {
  room._tickFn();
}

