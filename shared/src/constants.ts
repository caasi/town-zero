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
export const HOUSING_POPULATION_CAP = 4;      // population per housing structure
export const PRODUCTION_INPUT_COST = 2;       // raw materials consumed per production cycle
export const PRODUCTION_OUTPUT = 3;           // food/material produced per cycle
export const PRODUCTION_CYCLE_TICKS = 80;     // ticks per production cycle (~10s)

// --- Zone ---
export enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
  PRODUCTION = "production",
}

// --- Combat ---
export const BASE_ATTACK_DAMAGE = 20;

// --- Merchant ---
export const MERCHANT_SPAWN_INTERVAL = 960;   // ticks between merchant spawns (~120s)
export const MERCHANT_TRADE_RATE = 2;         // food/material per currency

// --- Dialogue ---
export const DIALOGUE_TIMEOUT_TICKS = 240;    // ticks before dialogue timeout (~30s)

// --- LLM ---
export const LLM_CALL_INTERVAL_MS = 20_000; // 20 seconds default
export const LLM_MIN_INTERVAL_MS = 10_000;  // 10 seconds for important NPCs
export const LLM_MAX_INTERVAL_MS = 30_000;  // 30 seconds for common NPCs

// --- Movement reconciliation ---
export const INPUT_QUEUE_CAP = 3;       // server-side per-agent input buffer depth
export const PENDING_INPUT_CAP = 20;   // client-side pending input buffer safety valve

export const DIRECTION_DELTA: Record<Facing, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
};
