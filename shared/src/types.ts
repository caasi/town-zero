export type ResourceType = "food" | "material" | "currency";

export interface ResourceStore {
  food: number;
  material: number;
  currency: number;
}

export function emptyResourceStore(): ResourceStore {
  return { food: 0, material: 0, currency: 0 };
}

export type ObjectType = "" | "bush";

export type TerrainType = "plains" | "forest" | "mountain" | "water" | "road";

export const TERRAIN_MOVE_COST: Record<TerrainType, number> = {
  plains: 1,
  forest: 2,
  mountain: 3,
  water: Infinity,
  road: 1,
};

export interface Position {
  x: number;
  y: number;
}

export type Facing = "north" | "south" | "east" | "west";

export type FrameAction =
  | { type: "gather"; resourceTile: Position }
  | { type: "attack"; targetId: string }
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

export function isMoveBlocked(
  x: number,
  y: number,
  map: { width: number; height: number },
  terrain: TerrainType | null | undefined,
): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return terrain != null && TERRAIN_MOVE_COST[terrain] === Infinity;
}

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

export type FSMState = "idle" | "dead";

export type SettlementType = "village" | "den";
export type StructureType = "housing" | "core";

export type ControllerType = "player" | "llm" | "bot";

export interface EntitySnapshot {
  id: string;
  type: string;
  faction: string;
  position: Position;
  role: string;
  hp: number;
  maxHp: number;
}

export interface TileMemory {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;
  resourceAmount: number;
}

export interface DialogueStatePayload {
  npcId: string;
  npcName: string;
  nodeType: "text" | "choice" | "waiting";
  speaker?: string;
  content?: string;
  options?: Array<{ id: string; label: string; enabled: boolean }>;
  timeoutAt: number;
}

