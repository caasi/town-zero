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

export type FSMState =
  | "idle"
  | "moving"
  | "gathering"
  | "fighting"
  | "operating" // operating a production facility
  | "trading"
  | "talking"
  | "dead";

// --- ActionCommand ---

export type ActionCommand =
  | { type: "move"; target: Position }
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
  | { type: "deposit"; settlementId: string }
  | { type: "take"; settlementId: string; resource: ResourceType; amount: number }
  | { type: "talk"; targetId: string; optionId: string }
  | { type: "trade"; targetId: string; offer: ResourceType; offerAmount: number; want: ResourceType; wantAmount: number }
  | { type: "idle" };

// --- Settlement ---

export type SettlementType = "village" | "den";
export type StructureType = "housing" | "production";

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

export type DialogueNodeId = string;

export type DialogueNode =
  | { type: "text"; speaker: string; content: string; next: DialogueNodeId }
  | { type: "choice"; options: DialogueChoice[] }
  | { type: "request"; label: string; gateType: "llm"; nextYes: DialogueNodeId; nextNo: DialogueNodeId }
  | { type: "action"; effect: string; next: DialogueNodeId }
  | { type: "end" };

export interface DialogueChoice {
  label: string;
  next: DialogueNodeId;
  condition?: string; // expression evaluated against locals
}

export interface DialogueTree {
  id: string;
  root: DialogueNodeId;
  nodes: Record<DialogueNodeId, DialogueNode>;
  defaultLocals?: Record<string, unknown>; // initial per-instance local variables
}
