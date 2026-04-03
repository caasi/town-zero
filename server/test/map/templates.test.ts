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
      [ZoneType.CORE, ZoneType.PRODUCTION],
    ];
    const result = stampTemplate(grid, template, 10, 10, "village-1");

    // Core is at [1][0], so world position = (10 + 0 - 0, 10 + 1 - 1) = (10, 10)
    expect(grid.getZoneType(10, 10)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(11, 9)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(11, 10)).toBe(ZoneType.PRODUCTION);
    expect(grid.getZoneType(10, 9)).toBe(ZoneType.EMPTY);

    // All tiles have ownerFaction set
    expect(grid.getOwner(10, 10)).toBe("village-1");
    expect(grid.getOwner(11, 9)).toBe("village-1");
    expect(grid.getOwner(10, 9)).toBe("village-1");

    // Returns territory and structures
    expect(result.territory).toHaveLength(4);
    expect(result.structures).toHaveLength(3); // core + housing + production
    const core = result.structures.find((s) => s.type === "core");
    expect(core).toBeDefined();
    expect(core!.id).toBe("village-1-core-10-10"); // deterministic ID from faction + zone + position
  });

  it("clips template at grid edges", () => {
    const grid = new Grid(5, 5);
    const template = [
      [ZoneType.HOUSING, ZoneType.CORE, ZoneType.HOUSING],
    ];
    // Core at [0][1], place at world (4, 2) → housing would be at (3,2), (4,2), (5,2)
    // (5,2) is out of bounds
    const result = stampTemplate(grid, template, 4, 2, "test");

    expect(grid.getZoneType(4, 2)).toBe(ZoneType.CORE);
    expect(grid.getZoneType(3, 2)).toBe(ZoneType.HOUSING);
    expect(grid.getZoneType(5, 2)).toBe(""); // out of bounds, not set
    expect(result.territory).toHaveLength(2); // only in-bounds tiles
  });
});
