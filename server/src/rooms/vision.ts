import type { TileMemory } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";

export interface VisionData {
  tick: number;
  tiles: Record<string, TileMemory>;
}

export function extractVisionForPlayer(agent: Agent, tick: number): VisionData {
  return {
    tick,
    tiles: Object.fromEntries(agent.getAllMemory()),
  };
}
