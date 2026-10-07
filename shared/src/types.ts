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

export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  // keepFood: the food the agent keeps for itself; all else goes into the store
  | { type: "deposit"; settlementId: string; keepFood?: number }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "talk"; targetId: string }
  | { type: "interact" }
  | { type: "idle" };

export interface InputFrame {
  seq: number;
  direction?: Facing;
  action?: FrameAction;
}

/**
 * Whether a move onto (x, y) is refused: off the map, or terrain that cannot
 * be entered. Unknown terrain (null/undefined) is not blocked: the client
 * predicts through fog and the server decides. Server moves, beast steps and
 * client prediction must share this rule, or prediction pulls the player back.
 */
export function isMoveBlocked(
  x: number,
  y: number,
  map: { width: number; height: number },
  terrain: TerrainType | null | undefined,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return terrain != null && TERRAIN_MOVE_COST[terrain] === Infinity;
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
export type StructureType = "housing" | "core";

// --- Agent ---

export type ControllerType = "player" | "llm" | "bot";

// --- MapMemory ---

export interface EntitySnapshot {
  id: string;
  type: string;       // "agent" | "monster"
  faction: string;
  position: Position;
  // As seen at the tick of the TileMemory: an agent knows the HP it last saw.
  role: string;
  hp: number;
  maxHp: number;
}

export interface TileMemory {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;   // tick when last observed
  resourceAmount: number; // units left on the tile when observed; 0 for a tile with no resource
}

// --- Dialogue ---

export interface DialogueStatePayload {
  npcId: string;
  npcName: string;
  nodeType: "text" | "choice" | "waiting"; // waiting: the NPC thinks; the client shows the text and ignores E
  speaker?: string;
  content?: string;
  options?: Array<{ id: string; label: string; enabled: boolean }>;
  timeoutAt: number;
}

