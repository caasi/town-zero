import type { Facing } from "./types.js";

export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 40;
export const TICK_RATE_MS = 125;

export const DEFAULT_VISION_RADIUS = 5;
export const SCOUT_VISION_RADIUS = 8;

export const DEFAULT_MAX_HP = 100;
export const FOOD_CONSUMPTION_INTERVAL = 240;
export const STARVATION_DAMAGE = 10;
export const DEFAULT_INVENTORY_CAPACITY = 20;

export const RESOURCE_MAX_AMOUNT = 3;
export const RESOURCE_REGROW_TICKS = 240;

export const PLAYER_NAME_MAX = 16;
export const PLAYER_NAME_MAX_MARKS = 3;
export const PLAYER_NAME_MAX_UNITS = 128;

// Close codes for a join that GameRoom.onJoin refuses. Not 4000 or 4001:
// Colyseus uses those (CONSENTED, SERVER_SHUTDOWN, sent on every deploy).
export const JOIN_REFUSED_NO_VILLAGE = 4100;
export const JOIN_REFUSED_FULL = 4101;

export const HOUSING_POPULATION_CAP = 6;

export enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
}

export const BASE_ATTACK_DAMAGE = 20;
export const REVIVE_DELAY_TICKS = 40;

export const DIALOGUE_TIMEOUT_TICKS = 240;

export const IDLE_TIMEOUT_TICKS = 960;

export const INPUT_QUEUE_CAP = 3;
export const PENDING_INPUT_CAP = 20;

export const DIRECTION_DELTA: Record<Facing, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
};
