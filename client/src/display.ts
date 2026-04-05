// client/src/display.ts
import { TERRAIN_MOVE_COST, DIRECTION_DELTA } from "@town-zero/shared";
import type { TerrainType, InputFrame } from "@town-zero/shared";
import { TILE_SIZE } from "./constants.js";

const BASE_LERP_FACTOR = 0.5;
const BASE_FRAME_MS = 16.67; // 60fps baseline

export interface AgentDisplay {
  displayX: number;
  displayY: number;
  renderX: number;
  renderY: number;
  facing: string;
}

type TileSource = { get(key: string): { terrain: string } | undefined };

interface ServerAgent {
  x: number;
  y: number;
  facing: string;
  lastProcessedInput: number;
  state: string;
}

export class DisplayState {
  private displays = new Map<string, AgentDisplay>();
  private localPlayerId: string | null = null;
  private tileSource: TileSource | null = null;

  setLocalPlayer(id: string | null): void {
    this.localPlayerId = id;
  }

  setTileSource(tiles: TileSource): void {
    this.tileSource = tiles;
  }

  getLocalPlayerPosition(): { x: number; y: number } | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return { x: display.displayX, y: display.displayY };
  }

  getLocalPlayerFacing(): string | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return display.facing;
  }

  /**
   * Attempt client-side predicted move for the local player.
   * Returns true if prediction was applied, false if invalid.
   */
  predictMove(
    targetX: number,
    targetY: number,
    agentState: string,
    tiles: TileSource,
  ): boolean {
    if (!this.localPlayerId) return false;
    if (agentState !== "idle") return false;

    const existing = this.displays.get(this.localPlayerId);
    const originX = existing?.displayX ?? targetX;
    const originY = existing?.displayY ?? targetY;
    const display = this.getOrCreate(this.localPlayerId, originX, originY);

    const dx = targetX - originX;
    const dy = targetY - originY;
    let intendedFacing = display.facing;
    if (dx > 0) intendedFacing = "east";
    else if (dx < 0) intendedFacing = "west";
    else if (dy > 0) intendedFacing = "south";
    else if (dy < 0) intendedFacing = "north";

    // Turn-before-move: if facing differs, only turn (no position change)
    if (intendedFacing !== display.facing) {
      display.facing = intendedFacing;
      return true;
    }

    const tile = tiles.get(`${targetX},${targetY}`);
    if (tile) {
      const terrain = tile.terrain as TerrainType;
      if (terrain in TERRAIN_MOVE_COST && TERRAIN_MOVE_COST[terrain] === Infinity) {
        return false;
      }
    }

    display.displayX = targetX;
    display.displayY = targetY;
    return true;
  }

  /**
   * Gambetta reconciliation for the local player.
   * 1. Accept server state as authoritative baseline
   * 2. Prune acknowledged inputs (seq <= lastProcessedInput)
   * 3. Replay remaining inputs from baseline
   * Returns the pruned pending input array.
   */
  reconcileFromServer(
    id: string,
    server: ServerAgent,
    pendingInputs: InputFrame[],
  ): InputFrame[] {
    const display = this.getOrCreate(id, server.x, server.y, server.facing);

    // Non-idle: clear all predictions, snap to server
    if (server.state !== "idle") {
      display.displayX = server.x;
      display.displayY = server.y;
      display.facing = server.facing;
      return [];
    }

    // Prune acknowledged inputs
    const remaining = pendingInputs.filter((p) => p.seq > server.lastProcessedInput);

    // Reset to server baseline before replay
    display.displayX = server.x;
    display.displayY = server.y;
    display.facing = server.facing;

    // Replay unacknowledged inputs (only direction frames affect position)
    const tiles = this.tileSource;
    if (tiles) {
      for (const input of remaining) {
        if (!input.direction) continue;
        const delta = DIRECTION_DELTA[input.direction];
        if (!delta) continue;
        const targetX = display.displayX + delta.dx;
        const targetY = display.displayY + delta.dy;
        // Inline turn-before-move + terrain check (same logic as predictMove)
        this.replayOne(display, targetX, targetY, input.direction, tiles);
      }
    }

    return remaining;
  }

  /**
   * Update display state from server for all agents.
   * Local player uses reconciliation (called separately via reconcileFromServer).
   * Other agents: always set to server position.
   */
  syncFromServer(
    agents: Iterable<[string, { x: number; y: number; facing: string }]>,
  ): void {
    const seen = new Set<string>();

    for (const [id, agent] of agents) {
      seen.add(id);
      if (id === this.localPlayerId) continue; // handled by reconcileFromServer
      const display = this.getOrCreate(id, agent.x, agent.y, agent.facing);
      display.displayX = agent.x;
      display.displayY = agent.y;
      display.facing = agent.facing;
    }

    for (const id of this.displays.keys()) {
      if (!seen.has(id)) {
        this.displays.delete(id);
      }
    }
  }

  updateRender(dt: number): void {
    const factor = 1 - Math.pow(1 - BASE_LERP_FACTOR, dt / BASE_FRAME_MS);

    for (const display of this.displays.values()) {
      const targetX = display.displayX * TILE_SIZE;
      const targetY = display.displayY * TILE_SIZE;
      display.renderX += (targetX - display.renderX) * factor;
      display.renderY += (targetY - display.renderY) * factor;
      if (Math.abs(display.renderX - targetX) < 0.5) display.renderX = targetX;
      if (Math.abs(display.renderY - targetY) < 0.5) display.renderY = targetY;
    }
  }

  get(id: string): AgentDisplay | undefined {
    return this.displays.get(id);
  }

  clear(): void {
    this.displays.clear();
    this.localPlayerId = null;
    this.tileSource = null;
  }

  private replayOne(
    display: AgentDisplay,
    targetX: number,
    targetY: number,
    direction: string,
    tiles: TileSource,
  ): void {
    // Turn-before-move
    if (direction !== display.facing) {
      display.facing = direction;
      return;
    }

    const tile = tiles.get(`${targetX},${targetY}`);
    if (tile) {
      const terrain = tile.terrain as TerrainType;
      if (terrain in TERRAIN_MOVE_COST && TERRAIN_MOVE_COST[terrain] === Infinity) {
        return;
      }
    }

    display.displayX = targetX;
    display.displayY = targetY;
  }

  private getOrCreate(id: string, initialX: number, initialY: number, facing = "south"): AgentDisplay {
    let display = this.displays.get(id);
    if (!display) {
      display = {
        displayX: initialX,
        displayY: initialY,
        renderX: initialX * TILE_SIZE,
        renderY: initialY * TILE_SIZE,
        facing,
      };
      this.displays.set(id, display);
    }
    return display;
  }
}
