// client/src/display.ts
import { TERRAIN_MOVE_COST } from "@town-zero/shared";
import type { TerrainType } from "@town-zero/shared";
import { TILE_SIZE } from "./constants.js";
const BASE_LERP_FACTOR = 0.5;
const BASE_FRAME_MS = 16.67; // 60fps baseline

export interface AgentDisplay {
  displayX: number;
  displayY: number;
  renderX: number;
  renderY: number;
}

export class DisplayState {
  private displays = new Map<string, AgentDisplay>();
  private lastServerPos = new Map<string, { x: number; y: number }>();
  private localPlayerId: string | null = null;

  setLocalPlayer(id: string | null): void {
    this.localPlayerId = id;
  }

  /**
   * Returns the local player's current predicted position (displayX/Y),
   * or null if no local player or no display entry exists.
   * Used by InputHandler to compute the next move target from the
   * predicted position rather than the stale server position.
   */
  getLocalPlayerPosition(): { x: number; y: number } | null {
    if (!this.localPlayerId) return null;
    const display = this.displays.get(this.localPlayerId);
    if (!display) return null;
    return { x: display.displayX, y: display.displayY };
  }

  /**
   * Attempt client-side predicted move for the local player.
   * Returns true if prediction was applied (caller should send command).
   * Returns false if move is invalid (caller should not send command).
   */
  predictMove(
    targetX: number,
    targetY: number,
    agentState: string,
    tiles: { get(key: string): { terrain: string } | undefined },
  ): boolean {
    if (!this.localPlayerId) return false;

    // Reject if agent is not idle
    if (agentState !== "idle") return false;

    // Check tile from fog snapshots (not raw server state)
    const tile = tiles.get(`${targetX},${targetY}`);

    // Reject only if terrain is known-impassable (water).
    // Mountains have finite move cost and are passable. Out-of-bounds and
    // unknown tiles are allowed optimistically — the server is authoritative
    // and will reject invalid moves, snapping the client back via sync.
    if (tile) {
      const terrain = tile.terrain as TerrainType;
      if (terrain in TERRAIN_MOVE_COST && TERRAIN_MOVE_COST[terrain] === Infinity) {
        return false;
      }
    }

    // Apply prediction by updating the display target to the destination.
    // If the local player does not yet have a display entry, initialize it
    // from the best known current origin so the first predicted move lerps
    // smoothly instead of snapping to the target.
    // Unknown tiles are allowed optimistically — server validates.
    const existing = this.displays.get(this.localPlayerId);
    const lastPos = this.lastServerPos.get(this.localPlayerId);
    const initialX = existing?.displayX ?? lastPos?.x ?? targetX;
    const initialY = existing?.displayY ?? lastPos?.y ?? targetY;
    const display = this.getOrCreate(this.localPlayerId, initialX, initialY);
    display.displayX = targetX;
    display.displayY = targetY;
    return true;
  }

  /**
   * Called when server state arrives. Updates display targets for all agents.
   * For the local player: only updates if server disagrees with prediction.
   * For others: always updates display target.
   */
  syncFromServer(
    agents: Iterable<[string, { x: number; y: number }]>,
  ): void {
    const seen = new Set<string>();

    for (const [id, agent] of agents) {
      seen.add(id);
      const display = this.getOrCreate(id, agent.x, agent.y);
      const lastPos = this.lastServerPos.get(id);

      if (id === this.localPlayerId) {
        // Only update display target when server position actually changes.
        // This preserves client-side predictions between server updates.
        if (!lastPos || lastPos.x !== agent.x || lastPos.y !== agent.y) {
          display.displayX = agent.x;
          display.displayY = agent.y;
        }
      } else {
        // For other agents, always track server position
        display.displayX = agent.x;
        display.displayY = agent.y;
      }

      this.lastServerPos.set(id, { x: agent.x, y: agent.y });
    }

    // Remove displays for agents that no longer exist
    for (const id of this.displays.keys()) {
      if (!seen.has(id)) {
        this.displays.delete(id);
        this.lastServerPos.delete(id);
      }
    }
  }

  /**
   * Called every animation frame. Lerps renderX/Y toward displayX/Y.
   * dt = milliseconds since last frame.
   */
  updateRender(dt: number): void {
    const factor = 1 - Math.pow(1 - BASE_LERP_FACTOR, dt / BASE_FRAME_MS);

    for (const display of this.displays.values()) {
      const targetX = display.displayX * TILE_SIZE;
      const targetY = display.displayY * TILE_SIZE;
      display.renderX += (targetX - display.renderX) * factor;
      display.renderY += (targetY - display.renderY) * factor;

      // Snap when close enough to avoid endless sub-pixel lerping
      if (Math.abs(display.renderX - targetX) < 0.5) display.renderX = targetX;
      if (Math.abs(display.renderY - targetY) < 0.5) display.renderY = targetY;
    }
  }

  get(id: string): AgentDisplay | undefined {
    return this.displays.get(id);
  }

  clear(): void {
    this.displays.clear();
    this.lastServerPos.clear();
    this.localPlayerId = null;
  }

  private getOrCreate(id: string, initialX: number, initialY: number): AgentDisplay {
    let display = this.displays.get(id);
    if (!display) {
      display = {
        displayX: initialX,
        displayY: initialY,
        renderX: initialX * TILE_SIZE,
        renderY: initialY * TILE_SIZE,
      };
      this.displays.set(id, display);
    }
    return display;
  }
}
