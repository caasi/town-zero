import type { Effect } from "../script-types.js";

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
  reason: "completed" | "timeout" | "player_left" | "npc_killed";
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
export type EventHandler<P> = (ctx: P) => Effect[];
export type Unsubscribe = () => void;
