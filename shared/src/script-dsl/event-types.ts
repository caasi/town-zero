import type { AgentRef } from "../script-types.js";

// Effects emitted by NPC event handlers. Deliberately kept tiny — and
// deliberately _not_ a member of the general `Effect` union — so that:
//   1. Returning `set_fact`/`give_item`/`damage`/etc. from an event handler is
//      a compile-time error rather than a silent runtime no-op.
//   2. Emitting `bubble` from dialogue actions or script triggers is also
//      impossible (the dialogue executor has no bubble handler, so previously
//      it would have thrown "Unknown effect type: bubble" at runtime).
// Script-level triggers remain the path for broader effect emission.
export type EventEffect = {
  type: "bubble";
  target: AgentRef;
  text: string;
  durationTicks: number;
};

export interface EntityRef {
  id: string;
  faction: string;
  role: string;
  position: { x: number; y: number };
}

interface EventBase {
  tick: number;
  self: EntityRef;
}

export interface ProximityEnterPayload extends EventBase {
  player: EntityRef;
  distance: number;
}
export interface ProximityStayPayload extends EventBase {
  player: EntityRef;
  distance: number;
  ticksInRange: number;
}
export interface ProximityLeavePayload extends EventBase {
  player: EntityRef;
}
export interface TalkStartPayload extends EventBase {
  player: EntityRef;
  dialogueId: string;
}
export interface TalkEndPayload extends EventBase {
  player: EntityRef;
  reason: "completed" | "timeout" | "player_left" | "npc_killed" | "error";
}
export interface CombatHitPayload extends EventBase {
  attacker: EntityRef;
  damage: number;
  hpAfter: number;
}
export interface CombatDeathPayload extends EventBase {
  killer: EntityRef | null;
}

export interface NpcEventMap {
  "proximity:enter": ProximityEnterPayload;
  "proximity:stay":  ProximityStayPayload;
  "proximity:leave": ProximityLeavePayload;
  "talk:start":      TalkStartPayload;
  "talk:end":        TalkEndPayload;
  "combat:hit":      CombatHitPayload;
  "combat:death":    CombatDeathPayload;
}

export type NpcEventName = keyof NpcEventMap;
export type EventHandler<P> = (ctx: P) => EventEffect[];
export type Unsubscribe = () => void;
