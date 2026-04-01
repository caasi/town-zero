const VISION_RADIUS = 5;

export class FogOfWar {
  private visibleSet = new Set<string>();

  update(playerX: number, playerY: number, gridWidth: number, gridHeight: number): void {
    this.visibleSet.clear();
    for (let dy = -VISION_RADIUS; dy <= VISION_RADIUS; dy++) {
      for (let dx = -VISION_RADIUS; dx <= VISION_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= VISION_RADIUS) {
          const x = playerX + dx;
          const y = playerY + dy;
          if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
            this.visibleSet.add(`${x},${y}`);
          }
        }
      }
    }
  }

  isVisible(x: number, y: number): boolean {
    return this.visibleSet.has(`${x},${y}`);
  }
}
