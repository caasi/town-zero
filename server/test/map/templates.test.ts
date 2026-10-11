import { describe, it, expect } from "vitest";
import { ZoneType } from "@town-zero/shared";
import {
  VILLAGE_TEMPLATE,
  DEN_TEMPLATE,
  findCore,
  stampTemplate,
} from "../../src/map/templates.js";
import { Grid } from "../../src/simulation/grid.js";

describe("Settlement Templates", () => {
  it("VILLAGE_TEMPLATE has exactly one CORE", () => {
    let coreCount = 0;
    for (const row of VILLAGE_TEMPLATE) {
      for (const cell of row) {
        if (cell === ZoneType.CORE) coreCount++;
      }
    }
    expect(coreCount).toBe(1);
  });

  it("DEN_TEMPLATE has exactly one CORE", () => {
    let coreCount = 0;
    for (const row of DEN_TEMPLATE) {
      for (const cell of row) {
        if (cell === ZoneType.CORE) coreCount++;
      }
    }
    expect(coreCount).toBe(1);
  });

  it("findCore returns core row and col", () => {
    const { row, col } = findCore(VILLAGE_TEMPLATE);
    expect(VILLAGE_TEMPLATE[row][col]).toBe(ZoneType.CORE);
  });
});

describe("stampTemplate", () => {
  it("stamps template onto grid setting ownerFaction and zoneType", () => {
    const grid = new Grid(20, 20);
    const template = [
      [ZoneType.EMPTY, ZoneType.HOUSING],
      [ZoneType.CORE, ZoneType.HOUSING],
    ];
    const result = stampTemplate(grid, template, 10, 10, "village-1");

    expect(grid.getZoneType(10, 10)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(11, 9)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(11, 10)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(10, 9)).toBe(ZoneType.EMPTY);

    expect(grid.getOwner(10, 10)).toBe("village-1");
    expect(grid.getOwner(11, 9)).toBe("village-1");
    expect(grid.getOwner(10, 9)).toBe("village-1");

    expect(result.territory).toHaveLength(4);
    expect(result.structures).toHaveLength(3);
    const core = result.structures.find((s) => s.type === "core");
    expect(core).toBeDefined();
    expect(core!.id).toBe("village-1-core-10-10");
  });

  it("clips template at grid edges", () => {
    const grid = new Grid(5, 5);
    const template = [
      [ZoneType.HOUSING, ZoneType.CORE, ZoneType.HOUSING],
    ];
    const result = stampTemplate(grid, template, 4, 2, "test");

    expect(grid.getZoneType(4, 2)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(3, 2)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(5, 2)).toBe("");
    expect(result.territory).toHaveLength(2);
  });
});
