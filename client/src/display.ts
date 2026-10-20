import { DIRECTION_DELTA, TICK_RATE_MS, isMoveBlocked } from "@town-zero/shared";
import type { TerrainType, InputFrame } from "@town-zero/shared";
import { TILE_SIZE } from "./constants.js";

const BASE_LERP_FACTOR = 0.5;
const BASE_FRAME_MS = 16.67;

export interface AgentDisplay {
  displayX: number;
  displayY: number;
  renderX: number;
  renderY: number;
  facing: string;
}

interface PredictedStep {
  fromRenderX: number;
  fromRenderY: number;
  toX: number;
  toY: number;
  startedAt: number;
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
  private predictedStep: PredictedStep | null = null;
  private tileSource: TileSource | null = null;
  private gridSize: { width: number; height: number } | null = null;

  setGridSize(width: number, height: number): void {
    this.gridSize = { width, height };
  }

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

  predictMove(
    targetX: number,
    targetY: number,
    agentState: string,
    tiles: TileSource,
    stepAt: number,
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

    if (intendedFacing !== display.facing) {
      display.facing = intendedFacing;
      return true;
    }

    if (this.blocked(targetX, targetY, tiles)) return false;

    const walking = this.isOnPredictedStep(display);
    this.predictedStep = {
      fromRenderX: walking ? display.displayX * TILE_SIZE : display.renderX,
      fromRenderY: walking ? display.displayY * TILE_SIZE : display.renderY,
      toX: targetX, toY: targetY,
      startedAt: stepAt,
    };
    display.displayX = targetX;
    display.displayY = targetY;
    return true;
  }

  reconcileFromServer(
    id: string,
    server: ServerAgent,
    pendingInputs: InputFrame[],
  ): InputFrame[] {
    const display = this.getOrCreate(id, server.x, server.y, server.facing);

    if (server.state !== "idle") {
      display.displayX = server.x;
      display.displayY = server.y;
      display.facing = server.facing;
      return [];
    }

    const remaining = pendingInputs.filter((p) => p.seq > server.lastProcessedInput);

    display.displayX = server.x;
    display.displayY = server.y;
    display.facing = server.facing;

    const tiles = this.tileSource;
    if (tiles) {
      for (const input of remaining) {
        if (input.action || !input.direction) continue;
        const delta = DIRECTION_DELTA[input.direction];
        if (!delta) continue;
        const targetX = display.displayX + delta.dx;
        const targetY = display.displayY + delta.dy;
        this.replayOne(display, targetX, targetY, input.direction, tiles);
      }
    }

    return remaining;
  }

  syncFromServer(
    agents: Iterable<[string, { x: number; y: number; facing: string }]>,
  ): void {
    const seen = new Set<string>();

    for (const [id, agent] of agents) {
      seen.add(id);
      if (id === this.localPlayerId) continue;
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

  updateRender(dt: number, now: number): void {
    const factor = 1 - Math.pow(1 - BASE_LERP_FACTOR, dt / BASE_FRAME_MS);

    for (const [id, display] of this.displays) {
      if (id === this.localPlayerId && this.followPredictedStep(display, now)) continue;
      const targetX = display.displayX * TILE_SIZE;
      const targetY = display.displayY * TILE_SIZE;
      display.renderX += (targetX - display.renderX) * factor;
      display.renderY += (targetY - display.renderY) * factor;
      if (Math.abs(display.renderX - targetX) < 0.5) display.renderX = targetX;
      if (Math.abs(display.renderY - targetY) < 0.5) display.renderY = targetY;
    }
  }

  private isOnPredictedStep(display: AgentDisplay): boolean {
    const step = this.predictedStep;
    return step !== null && step.toX === display.displayX && step.toY === display.displayY;
  }

  private followPredictedStep(display: AgentDisplay, now: number): boolean {
    const step = this.predictedStep;
    if (!step || !this.isOnPredictedStep(display)) {
      this.predictedStep = null;
      return false;
    }
    const progress = Math.min(1, Math.max(0, (now - step.startedAt) / TICK_RATE_MS));
    display.renderX = step.fromRenderX + (step.toX * TILE_SIZE - step.fromRenderX) * progress;
    display.renderY = step.fromRenderY + (step.toY * TILE_SIZE - step.fromRenderY) * progress;
    if (progress === 1) this.predictedStep = null;
    return true;
  }

  get(id: string): AgentDisplay | undefined {
    return this.displays.get(id);
  }

  clear(): void {
    this.displays.clear();
    this.localPlayerId = null;
    this.predictedStep = null;
    this.tileSource = null;
  }

  private blocked(x: number, y: number, tiles: TileSource): boolean {
    const map = this.gridSize ?? { width: Infinity, height: Infinity };
    return isMoveBlocked(x, y, map, tiles.get(`${x},${y}`)?.terrain as TerrainType | undefined);
  }

  private replayOne(
    display: AgentDisplay,
    targetX: number,
    targetY: number,
    direction: string,
    tiles: TileSource,
  ): void {
    if (direction !== display.facing) {
      display.facing = direction;
      return;
    }

    if (this.blocked(targetX, targetY, tiles)) return;

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
