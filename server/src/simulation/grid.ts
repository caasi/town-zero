import { tilesInManhattanRadius } from "@town-zero/shared";
import type { Position, TerrainType, ResourceType } from "@town-zero/shared";

interface TileData {
  terrain: TerrainType;
  owner: string | null;
  resourceYield: ResourceType | null;
  zoneType: string;
}

export class Grid {
  readonly width: number;
  readonly height: number;
  private tiles: TileData[];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tiles = Array.from({ length: width * height }, () => ({
      terrain: "plains" as TerrainType,
      owner: null,
      resourceYield: null,
      zoneType: "",
    }));
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getTerrain(x: number, y: number): TerrainType | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].terrain;
  }

  setTerrain(x: number, y: number, terrain: TerrainType): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].terrain = terrain;
  }

  getOwner(x: number, y: number): string | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].owner;
  }

  setOwner(x: number, y: number, owner: string | null): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].owner = owner;
  }

  getResourceYield(x: number, y: number): ResourceType | null {
    if (!this.inBounds(x, y)) return null;
    return this.tiles[this.index(x, y)].resourceYield;
  }

  setResourceYield(x: number, y: number, resource: ResourceType | null): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].resourceYield = resource;
  }

  getZoneType(x: number, y: number): string {
    if (!this.inBounds(x, y)) return "";
    return this.tiles[this.index(x, y)].zoneType;
  }

  setZoneType(x: number, y: number, zoneType: string): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].zoneType = zoneType;
  }

  getNeighbors(x: number, y: number): Position[] {
    const dirs: Position[] = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];
    return dirs.filter((p) => this.inBounds(p.x, p.y));
  }

  isAdjacent(a: Position, b: Position): boolean {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  distance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getTilesInRadius(center: Position, radius: number): Position[] {
    return tilesInManhattanRadius(center, radius)
      .filter((p) => this.inBounds(p.x, p.y));
  }
}
