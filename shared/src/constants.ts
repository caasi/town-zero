import type { Facing } from "./types.js";

// --- World ---
export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 40;
export const TICK_RATE_MS = 125; // 8 ticks per second

// --- Vision ---
export const DEFAULT_VISION_RADIUS = 5;
export const SCOUT_VISION_RADIUS = 8;

// --- Agent ---
export const DEFAULT_MAX_HP = 100;
export const FOOD_CONSUMPTION_INTERVAL = 240; // ticks between food consumption (~30s)
export const STARVATION_DAMAGE = 10;          // HP lost per interval when starving
export const DEFAULT_INVENTORY_CAPACITY = 20;

// --- Settlement ---
export const HOUSING_POPULATION_CAP = 6;      // population per housing structure (village: 2 x 6 = 12)

// --- Zone ---
export enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
}

// --- Combat ---
export const BASE_ATTACK_DAMAGE = 20;
export const REVIVE_DELAY_TICKS = 40;          // ticks before a dead player may revive (~5s)

// --- Dialogue ---
export const DIALOGUE_TIMEOUT_TICKS = 240;    // ticks before dialogue timeout (~30s)

// --- Presence ---
export const IDLE_TIMEOUT_TICKS = 960;        // ticks without a player message before the player counts as idle (~2 min)

// --- Movement reconciliation ---
export const INPUT_QUEUE_CAP = 3;       // server-side per-agent input buffer depth
export const PENDING_INPUT_CAP = 20;   // client-side pending input buffer safety valve

export const DIRECTION_DELTA: Record<Facing, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
};
