import type { TerrainType, EntitySnapshot, ZoneType } from "@town-zero/shared";

export type FogLevel = "visible" | "explored" | "unknown";

export interface TileSnapshot {
  terrain: TerrainType;
  entities: EntitySnapshot[];
  timestamp: number;
  resourceYield?: string;
  zoneType?: ZoneType;
  ownerFaction?: string;
  structureId?: string;
  objectType?: string;
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

export type { TerrainType, EntitySnapshot };
