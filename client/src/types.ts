// client/src/types.ts
import type { TerrainType, EntitySnapshot, ActionCommand } from "@town-zero/shared";

export type FogLevel = "visible" | "explored" | "unknown";

export interface FogEntry {
  level: FogLevel;
  terrain: TerrainType;
  lastEntities: EntitySnapshot[];
  timestamp: number;
}

export interface VisionData {
  tick: number;
  tiles: Record<string, {
    terrain: TerrainType;
    entities: EntitySnapshot[];
    timestamp: number;
  }>;
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
