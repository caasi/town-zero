// --- World ---
export const GRID_WIDTH = 40;
export const GRID_HEIGHT = 40;
export const TICK_RATE_MS = 1000; // 1 tick per second

// --- Vision ---
export const DEFAULT_VISION_RADIUS = 5;
export const SCOUT_VISION_RADIUS = 8;

// --- Agent ---
export const DEFAULT_MAX_HP = 100;
export const FOOD_CONSUMPTION_INTERVAL = 30; // ticks between food consumption
export const STARVATION_DAMAGE = 10;         // HP lost per interval when starving
export const DEFAULT_INVENTORY_CAPACITY = 20;
export const GATHER_DURATION = 5;            // ticks to complete gathering

// --- Settlement ---
export const HOUSING_POPULATION_CAP = 4;     // population per housing structure
export const PRODUCTION_INPUT_COST = 2;      // raw materials consumed per production cycle
export const PRODUCTION_OUTPUT = 3;          // food/material produced per cycle
export const PRODUCTION_CYCLE_TICKS = 10;    // ticks per production cycle

// --- Zone ---
export enum ZoneType {
  EMPTY = "",
  CORE = "core",
  HOUSING = "housing",
  PRODUCTION = "production",
}

// --- Combat ---
export const BASE_ATTACK_DAMAGE = 20;
export const ATTACK_COOLDOWN_TICKS = 3;

// --- Merchant ---
export const MERCHANT_SPAWN_INTERVAL = 120;  // ticks between merchant spawns
export const MERCHANT_TRADE_RATE = 2;        // food/material per currency

// --- Dialogue ---
export const DIALOGUE_TIMEOUT_TICKS = 30; // seconds at 1 tick/s

// --- LLM ---
export const LLM_CALL_INTERVAL_MS = 20_000; // 20 seconds default
export const LLM_MIN_INTERVAL_MS = 10_000;  // 10 seconds for important NPCs
export const LLM_MAX_INTERVAL_MS = 30_000;  // 30 seconds for common NPCs
