// client/src/camera.ts
import type { Viewport } from "./types.js";

const TILE_SIZE = 32;

export class Camera {
  private canvasWidth = 0;
  private canvasHeight = 0;
  private gridWidth = 0;
  private gridHeight = 0;
  private viewport: Viewport = { startX: 0, startY: 0, endX: 0, endY: 0, offsetX: 0, offsetY: 0 };

  setCanvasSize(width: number, height: number): void {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  setGridSize(width: number, height: number): void {
    this.gridWidth = width;
    this.gridHeight = height;
  }

  update(playerX: number, playerY: number): void {
    const tilesX = Math.ceil(this.canvasWidth / TILE_SIZE) + 1;
    const tilesY = Math.ceil(this.canvasHeight / TILE_SIZE) + 1;

    const halfW = tilesX / 2;
    const halfH = tilesY / 2;

    let startX = Math.floor(playerX - halfW + 0.5);
    let startY = Math.floor(playerY - halfH + 0.5);

    // Clamp to grid bounds
    startX = Math.max(0, Math.min(startX, this.gridWidth - tilesX));
    startY = Math.max(0, Math.min(startY, this.gridHeight - tilesY));

    const endX = Math.min(startX + tilesX, this.gridWidth);
    const endY = Math.min(startY + tilesY, this.gridHeight);

    // Pixel offset for centering
    const offsetX = (this.canvasWidth / 2) - (playerX - startX + 0.5) * TILE_SIZE;
    const offsetY = (this.canvasHeight / 2) - (playerY - startY + 0.5) * TILE_SIZE;

    this.viewport = { startX, startY, endX, endY, offsetX, offsetY };
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  getTileSize(): number {
    return TILE_SIZE;
  }
}
