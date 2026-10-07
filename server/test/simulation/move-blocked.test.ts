import { describe, it, expect } from "vitest";
import { isMoveBlocked } from "@town-zero/shared";

// One rule for server moves, beast steps and client prediction.
describe("isMoveBlocked", () => {
  const map = { width: 10, height: 10 };

  it.each([
    [-1, 5], [10, 5], [5, -1], [5, 10],
  ])("blocks (%i, %i), off the map", (x, y) => {
    expect(isMoveBlocked(x, y, map, "plains")).toBe(true);
  });

  it("blocks terrain that cannot be entered", () => {
    expect(isMoveBlocked(5, 5, map, "water")).toBe(true);
  });

  it("allows passable terrain on the map, edges included", () => {
    expect(isMoveBlocked(0, 0, map, "plains")).toBe(false);
    expect(isMoveBlocked(9, 9, map, "forest")).toBe(false);
  });

  it("does not block unknown terrain on the map (fog: the server decides)", () => {
    expect(isMoveBlocked(5, 5, map, undefined)).toBe(false);
    expect(isMoveBlocked(5, 5, map, null)).toBe(false);
  });
});
