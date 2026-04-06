// --- Resources ---

export type ResourceType = "food" | "material" | "currency";

export interface ResourceStore {
  food: number;
  material: number;
  currency: number;
}

export function emptyResourceStore(): ResourceStore {
  return { food: 0, material: 0, currency: 0 };
}

// --- Tile Objects ---

export type ObjectType = "" | "bush";

// --- Terrain ---

export type TerrainType = "plains" | "forest" | "mountain" | "water" | "road";

export const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  plains: 1,
  forest: 2,
  mountain: 3,
  water: Infinity, // impassable
  road: 1,
};

// --- Grid ---

export interface Position {
  x: number;
  y: number;
}

export type Facing = "north" | "south" | "east" | "west";

export interface PendingInput {
  seq: number;
  direction: Facing;
}

export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "talk"; targetId: string }
  | { type: "idle" };

export interface InputFrame {
  seq: number;
  direction?: Facing;
  action?: FrameAction;
}

/**
 * Returns all positions within Manhattan distance `radius` of `center`.
 * Used by both server vision and client fog prediction.
 */
export function tilesInManhattanRadius(center: Position, radius: number): Position[] {
  const result: Position[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) <= radius) {
        result.push({ x: center.x + dx, y: center.y + dy });
      }
    }
  }
  return result;
}

// --- FSM ---

export type FSMState = "idle" | "dead";

// --- Settlement ---

export type SettlementType = "village" | "den";
export type StructureType = "housing" | "production" | "core";

// --- Agent ---

export type ControllerType = "player" | "llm" | "bot";

// --- MapMemory ---

export interface EntitySnapshot {
  id: string;
  type: string;       // "agent" | "merchant" | "monster"
  faction: string;
  position: Position;
}

export interface TileMemory {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;   // tick when last observed
}

// --- Dialogue ---

export interface DialogueStatePayload {
  npcId: string;
  npcName: string;
  nodeType: "text" | "choice" | "request_pending";
  speaker?: string;
  content?: string;
  options?: Array<{ id: string; label: string; enabled: boolean }>;
  timeoutAt: number;
}

