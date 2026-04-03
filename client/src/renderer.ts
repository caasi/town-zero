// client/src/renderer.ts
import { ZoneType } from "@town-zero/shared";
import type { FogLevel } from "./types.js";
import type { FogManager } from "./fog.js";
import type { Camera } from "./camera.js";
import type { DisplayState } from "./display.js";
import { TILE_SIZE } from "./constants.js";

const EIGENGRAU = "#16161d"; // perceived color of darkness — used for unknown tiles

const TERRAIN_COLORS: Record<string, string> = {
  plains: "#3a6a3e",
  forest: "#1a4a1a",
  mountain: "#7a6a5a",
  water: "#1a4a7a",
  road: "#b8a87a",
};

const FOG_ALPHA: Record<FogLevel, number> = {
  visible: 0,
  explored: 0.5,
  unknown: 0.9,
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  draw(
    state: any,
    fog: FogManager,
    camera: Camera,
    playerId: string | null,
    displayState?: DisplayState,
  ): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    const vp = camera.getViewport();

    // Extract player faction for enemy detection
    let playerFaction = "";
    if (playerId && state?.agents) {
      const pa = state.agents.get(playerId);
      if (pa) playerFaction = pa.faction;
    }

    // Void (outside map) is true black
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Draw tiles
    for (let y = vp.startY; y < vp.endY; y++) {
      for (let x = vp.startX; x < vp.endX; x++) {
        const px = (x - vp.startX) * TILE_SIZE + vp.offsetX;
        const py = (y - vp.startY) * TILE_SIZE + vp.offsetY;
        const fogLevel = fog.getLevel(x, y);

        if (fogLevel === "unknown") {
          // Eigengrau — distinguishes "unseen tile" from "void outside map"
          ctx.fillStyle = EIGENGRAU;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          continue;
        }

        this.drawTile(ctx, px, py, fog, x, y, fogLevel);
      }
    }

    // Draw agents on visible tiles (from live server state)
    if (state?.agents) {
      state.agents.forEach((agent: any) => {
        // Use lerped render position if available, else fall back to server position
        const display = displayState?.get(agent.id);
        const pxWorld = display ? display.renderX : agent.x * TILE_SIZE;
        const pyWorld = display ? display.renderY : agent.y * TILE_SIZE;

        // Convert from world pixel coords to screen coords
        const px = pxWorld - vp.startX * TILE_SIZE + vp.offsetX;
        const py = pyWorld - vp.startY * TILE_SIZE + vp.offsetY;

        // Use stable integer tile position for fog/culling to avoid
        // mid-lerp flicker when rounding flips at the half-tile point.
        const tileX = display ? display.displayX : agent.x;
        const tileY = display ? display.displayY : agent.y;
        const fl = fog.getLevel(tileX, tileY);
        if (fl !== "visible") return;

        // Cull agents outside viewport (with 1-tile margin for sliding agents)
        if (tileX < vp.startX - 1 || tileX > vp.endX || tileY < vp.startY - 1 || tileY > vp.endY) return;

        this.drawAgent(ctx, px, py, agent, playerId, playerFaction, "visible");
      });
    }

    // Draw remembered entities on explored tiles (from fog memory)
    for (let y = vp.startY; y < vp.endY; y++) {
      for (let x = vp.startX; x < vp.endX; x++) {
        const fl = fog.getLevel(x, y);
        if (fl !== "explored") continue;
        const snapshot = fog.getSnapshot(x, y);
        if (!snapshot?.entities.length) continue;
        const px = (x - vp.startX) * TILE_SIZE + vp.offsetX;
        const py = (y - vp.startY) * TILE_SIZE + vp.offsetY;
        for (const entity of snapshot.entities) {
          this.drawFogEntity(ctx, px, py, entity, playerFaction);
        }
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    fog: FogManager, x: number, y: number, fogLevel: FogLevel,
  ): void {
    // Read terrain from fog snapshots, not raw server state.
    // This respects the information model: explored tiles show
    // what the player last observed, not omniscient live data.
    let terrain = "plains";
    let resourceYield = "";
    const snapshot = fog.getSnapshot(x, y);
    if (snapshot) {
      terrain = snapshot.terrain || "plains";
      resourceYield = snapshot.resourceYield || "";
    }

    // Base color
    ctx.fillStyle = TERRAIN_COLORS[terrain] ?? TERRAIN_COLORS.plains;
    ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

    // Terrain patterns (only if not unknown)
    if (fogLevel !== "unknown") {
      this.drawTerrainPattern(ctx, px, py, terrain);
    }

    // Zone overlay (after terrain pattern, before resource dot)
    if (fogLevel !== "unknown") {
      const zoneType = snapshot?.zoneType ?? ZoneType.EMPTY;
      const ownerFaction = snapshot?.ownerFaction || "";

      if (zoneType) {
        this.drawZoneOverlay(ctx, px, py, zoneType, ownerFaction);
      } else if (ownerFaction) {
        this.drawTerritoryBorder(ctx, px, py, ownerFaction);
      }
    }

    // Bush object (drawTile is only called for non-"unknown" fog levels)
    const objectType = snapshot?.objectType || "";
    if (objectType === "bush") {
      ctx.fillStyle = "#2a8a2a";
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2 - 6, py + TILE_SIZE / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2 + 4, py + TILE_SIZE / 2 - 4, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2 + 3, py + TILE_SIZE / 2 + 5, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Resource yield dot
    if (fogLevel !== "unknown" && resourceYield) {
      ctx.fillStyle = resourceYield === "food" ? "#6a6" : "#a86";
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE - 6, py + 6, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Grid lines
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);

    // Fog overlay
    const alpha = FOG_ALPHA[fogLevel];
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  private drawTerrainPattern(ctx: CanvasRenderingContext2D, px: number, py: number, terrain: string): void {
    switch (terrain) {
      case "forest":
        ctx.fillStyle = "#0a3a0a";
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(px + 6 + i * 10, py + 10 + (i % 2) * 10, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case "mountain":
        ctx.fillStyle = "#5a4a3a";
        ctx.beginPath();
        ctx.moveTo(px + 8, py + TILE_SIZE - 4);
        ctx.lineTo(px + 16, py + 6);
        ctx.lineTo(px + 24, py + TILE_SIZE - 4);
        ctx.closePath();
        ctx.fill();
        break;
      case "water":
        ctx.strokeStyle = "#3a6a9a";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 16);
        ctx.quadraticCurveTo(px + 16, py + 10, px + 28, py + 16);
        ctx.stroke();
        break;
      case "road":
        ctx.strokeStyle = "#a8986a";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px + TILE_SIZE / 2, py);
        ctx.lineTo(px + TILE_SIZE / 2, py + TILE_SIZE);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
    }
  }

  private drawZoneOverlay(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    zoneType: ZoneType, ownerFaction: string,
  ): void {
    const isVillage = ownerFaction.startsWith("village");
    const factionColor = isVillage ? "#d4a037" : "#8a4a8a";

    let fillColor: string;
    let marker: string;
    let opacity: number;

    switch (zoneType) {
      case ZoneType.CORE:
        fillColor = factionColor;
        marker = "\u2605"; // ★
        opacity = 0.6;
        break;
      case ZoneType.HOUSING:
        fillColor = "#c4843a";
        marker = "H";
        opacity = 0.5;
        break;
      case ZoneType.PRODUCTION:
        fillColor = "#5a9e4b";
        marker = "P";
        opacity = 0.5;
        break;
      default:
        return;
    }

    ctx.globalAlpha = opacity;
    ctx.fillStyle = fillColor;
    ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(marker, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }

  private drawTerritoryBorder(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    ownerFaction: string,
  ): void {
    const isVillage = ownerFaction.startsWith("village");
    const color = isVillage ? "#d4a037" : "#8a4a8a";
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.globalAlpha = 1;
  }

  private drawAgent(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    agent: any, playerId: string | null, playerFaction: string, _fogLevel: FogLevel,
  ): void {
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    const isPlayer = agent.id === playerId;
    const isDead = agent.state === "dead" || agent.hp <= 0;

    ctx.globalAlpha = isDead ? 0.5 : 1;

    if (agent.role === "merchant") {
      // Circle - merchant
      ctx.fillStyle = "#da3";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE / 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (isPlayer) {
      // Diamond - player (only on visible tiles)
      ctx.fillStyle = "#4af";
      ctx.beginPath();
      ctx.moveTo(cx, py + 3);
      ctx.lineTo(px + TILE_SIZE - 3, cy);
      ctx.lineTo(cx, py + TILE_SIZE - 3);
      ctx.lineTo(px + 3, cy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Triangle - other agents
      const isEnemy = playerFaction !== "" && agent.faction !== playerFaction;
      ctx.fillStyle = isEnemy ? "#c44" : "#6c6";
      ctx.beginPath();
      ctx.moveTo(cx, py + 4);
      ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
      ctx.lineTo(px + 4, py + TILE_SIZE - 4);
      ctx.closePath();
      ctx.fill();
      if (!isEnemy) {
        ctx.strokeStyle = "#3a3";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Dead X mark
    if (isDead) {
      ctx.strokeStyle = "#f00";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + 8, py + 8);
      ctx.lineTo(px + TILE_SIZE - 8, py + TILE_SIZE - 8);
      ctx.moveTo(px + TILE_SIZE - 8, py + 8);
      ctx.lineTo(px + 8, py + TILE_SIZE - 8);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  private drawFogEntity(
    ctx: CanvasRenderingContext2D, px: number, py: number,
    entity: { id: string; type: string; faction: string; position: { x: number; y: number } },
    playerFaction: string,
  ): void {
    const cx = px + TILE_SIZE / 2;
    const cy = py + TILE_SIZE / 2;
    ctx.globalAlpha = 0.4;

    if (entity.type === "merchant") {
      ctx.fillStyle = "#da3";
      ctx.beginPath();
      ctx.arc(cx, cy, TILE_SIZE / 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // All agents render as triangles in fog (no diamond distinction)
      const isEnemy = playerFaction !== "" && entity.faction !== playerFaction;
      ctx.fillStyle = isEnemy ? "#c44" : "#6c6";
      ctx.beginPath();
      ctx.moveTo(cx, py + 4);
      ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 4);
      ctx.lineTo(px + 4, py + TILE_SIZE - 4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}
