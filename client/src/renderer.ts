import type { WorldState } from "./types.js";
import type { FogOfWar } from "./fog.js";

const TILE_SIZE = 16;

const TERRAIN_COLORS: Record<string, string> = {
  plains: "#4a7c59",
  forest: "#2d5a27",
  mountain: "#6b6b6b",
  water: "#2266aa",
  road: "#8b7355",
};

const AGENT_COLORS: Record<string, string> = {
  "village-1": "#4488ff",
  "den-1": "#ff4444",
  "merchant": "#ffaa00",
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cameraX = 0;
  private cameraY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  centerOn(x: number, y: number): void {
    this.cameraX = x * TILE_SIZE - this.canvas.width / 2;
    this.cameraY = y * TILE_SIZE - this.canvas.height / 2;
  }

  screenToGrid(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: Math.floor((screenX + this.cameraX) / TILE_SIZE),
      y: Math.floor((screenY + this.cameraY) / TILE_SIZE),
    };
  }

  render(state: WorldState, playerId: string | null, fog: FogOfWar | null): void {
    const { ctx } = this;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const tiles = state.tiles;
    if (!tiles) return;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const screenX = tile.x * TILE_SIZE - this.cameraX;
      const screenY = tile.y * TILE_SIZE - this.cameraY;

      if (screenX + TILE_SIZE < 0 || screenX > this.canvas.width) continue;
      if (screenY + TILE_SIZE < 0 || screenY > this.canvas.height) continue;

      ctx.fillStyle = TERRAIN_COLORS[tile.terrain] ?? "#333";
      ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);

      if (tile.resourceYield) {
        ctx.fillStyle = tile.resourceYield === "food" ? "#ffcc00" : "#cc8844";
        ctx.fillRect(screenX + 5, screenY + 5, 6, 6);
      }

      if (tile.owner) {
        ctx.fillStyle = tile.owner.startsWith("village") ? "rgba(68,136,255,0.15)" : "rgba(255,68,68,0.15)";
        ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);
      }

      // Fog of war overlay
      if (fog && !fog.isVisible(tile.x, tile.y)) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(screenX, screenY, TILE_SIZE - 1, TILE_SIZE - 1);
      }
    }

    // Draw agents
    state.agents?.forEach((agent) => {
      if (agent.state === "dead") return;

      // Hide agents outside fog
      if (fog && !fog.isVisible(agent.x, agent.y)) return;

      const screenX = agent.x * TILE_SIZE - this.cameraX;
      const screenY = agent.y * TILE_SIZE - this.cameraY;

      ctx.fillStyle = AGENT_COLORS[agent.faction] ?? "#ffffff";
      if (agent.id === playerId) {
        ctx.fillStyle = "#00ff88";
      }

      const size = agent.controller === "player" ? TILE_SIZE - 2 : TILE_SIZE - 4;
      const offset = (TILE_SIZE - size) / 2;
      ctx.fillRect(screenX + offset, screenY + offset, size - 1, size - 1);

      if (agent.hp < agent.maxHp) {
        const barWidth = TILE_SIZE - 2;
        const hpRatio = agent.hp / agent.maxHp;
        ctx.fillStyle = "#333";
        ctx.fillRect(screenX + 1, screenY - 4, barWidth, 3);
        ctx.fillStyle = hpRatio > 0.5 ? "#0f0" : hpRatio > 0.25 ? "#ff0" : "#f00";
        ctx.fillRect(screenX + 1, screenY - 4, barWidth * hpRatio, 3);
      }
    });
  }
}
