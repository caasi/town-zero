import { RESOURCE_MAX_AMOUNT, tilesInManhattanRadius, ZoneType } from "@town-zero/shared";
import type { Position, TerrainType, ResourceType, ObjectType } from "@town-zero/shared";

interface TileData {
  terrain: TerrainType;
  owner: string | null;
  resourceYield: ResourceType | null;
  resourceAmount: number;
  zoneType: ZoneType;
  objectType: ObjectType;
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
      resourceAmount: 0,
      zoneType: ZoneType.EMPTY,
      objectType: "",
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
    const tile = this.tiles[this.index(x, y)];
    tile.resourceYield = resource;
    tile.resourceAmount = resource ? RESOURCE_MAX_AMOUNT : 0;
  }

  getResourceAmount(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.tiles[this.index(x, y)].resourceAmount;
  }

  /** Takes one unit; null when the tile has no resource or is used up. */
  takeResource(x: number, y: number): ResourceType | null {
    if (!this.inBounds(x, y)) return null;
    const tile = this.tiles[this.index(x, y)];
    if (!tile.resourceYield || tile.resourceAmount === 0) return null;
    tile.resourceAmount--;
    return tile.resourceYield;
  }

  regrowResources(): void {
    for (const tile of this.tiles) {
      if (tile.resourceYield && tile.resourceAmount < RESOURCE_MAX_AMOUNT) tile.resourceAmount++;
    }
  }

  getZoneType(x: number, y: number): ZoneType {
    if (!this.inBounds(x, y)) return ZoneType.EMPTY;
    return this.tiles[this.index(x, y)].zoneType;
  }

  setZoneType(x: number, y: number, zoneType: ZoneType): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].zoneType = zoneType;
  }

  getObjectType(x: number, y: number): ObjectType {
    if (!this.inBounds(x, y)) return "";
    return this.tiles[this.index(x, y)].objectType;
  }

  setObjectType(x: number, y: number, type: ObjectType): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.index(x, y)].objectType = type;
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
