import { ZoneType } from "@town-zero/shared";
import type { Position, StructureType } from "@town-zero/shared";

const ZONE_TO_STRUCTURE = {
  [ZoneType.CORE]: "core",
  [ZoneType.HOUSING]: "housing",
  [ZoneType.PRODUCTION]: "production",
} satisfies Record<Exclude<ZoneType, ZoneType.EMPTY>, StructureType>;
import type { Grid } from "../simulation/grid.js";

// --- Templates ---

const _ = ZoneType.EMPTY;
const C = ZoneType.CORE;
const H = ZoneType.HOUSING;
const P = ZoneType.PRODUCTION;

export const VILLAGE_TEMPLATE: ZoneType[][] = [
  [_, P, _, H, _],
  [_, _, _, _, _],
  [_, H, C, P, _],
  [_, _, _, _, _],
  [_, _, _, _, _],
];

// Den is intentionally smaller than village (4×4 vs 5×5)
export const DEN_TEMPLATE: ZoneType[][] = [
  [_, H, _, _],
  [_, C, P, _],
  [_, _, _, _],
  [_, _, _, _],
];

// --- Helpers ---

export function findCore(template: ZoneType[][]): { row: number; col: number } {
  for (let row = 0; row < template.length; row++) {
    for (let col = 0; col < template[row].length; col++) {
      if (template[row][col] === ZoneType.CORE) return { row, col };
    }
  }
  throw new Error("Template has no CORE cell");
}

interface StampResult {
  territory: Position[];
  structures: { id: string; type: StructureType; position: Position; operatorId: null }[];
}

export function stampTemplate(
  grid: Grid,
  template: ZoneType[][],
  coreX: number,
  coreY: number,
  faction: string,
): StampResult {
  const { row: coreRow, col: coreCol } = findCore(template);
  const territory: Position[] = [];
  const structures: StampResult["structures"] = [];

  for (let row = 0; row < template.length; row++) {
    for (let col = 0; col < template[row].length; col++) {
      const worldX = coreX + (col - coreCol);
      const worldY = coreY + (row - coreRow);

      if (!grid.inBounds(worldX, worldY)) continue;

      const zone = template[row][col];
      grid.setOwner(worldX, worldY, faction);
      grid.setZoneType(worldX, worldY, zone);
      territory.push({ x: worldX, y: worldY });

      if (zone === ZoneType.EMPTY) continue;
      const structureType = ZONE_TO_STRUCTURE[zone];
      if (structureType) {
        structures.push({
          id: `${faction}-${zone}-${worldX}-${worldY}`,
          type: structureType,
          position: { x: worldX, y: worldY },
          operatorId: null,
        });
      }
    }
  }

  return { territory, structures };
}
