// client/src/types.ts
import type { TerrainType, EntitySnapshot, ActionCommand } from "@town-zero/shared";

export type FogLevel = "visible" | "explored" | "unknown";

/** A frozen snapshot of a tile at the time it was last observed. */
export interface TileSnapshot {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;
  resourceYield?: string;
  zoneType?: string;
  ownerFaction?: string;
  structureId?: string;
  operatorId?: string | null;
}

export interface VisionData {
  tick: number;
  tiles: Record<string, TileSnapshot>;
}

export interface Viewport {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  offsetX: number;
  offsetY: number;
}

export type GameState = "connecting" | "playing" | "dead" | "error";

export type ModalRequest =
  | { type: "trade"; merchantId: string }
  | { type: "dialogue"; targetId: string };

export type { ActionCommand, TerrainType, EntitySnapshot };
