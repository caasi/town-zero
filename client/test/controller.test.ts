import { describe, it, expect } from "vitest";
import { padDirection } from "../src/controller.js";

describe("padDirection", () => {
  it("picks the axis with the larger offset; screen y grows down", () => {
    expect(padDirection(30, 5)).toBe("TouchRight");
    expect(padDirection(-30, 5)).toBe("TouchLeft");
    expect(padDirection(5, 30)).toBe("TouchDown");
    expect(padDirection(5, -30)).toBe("TouchUp");
  });

  it("is null in the dead zone at the center", () => {
    expect(padDirection(3, -4)).toBeNull();
  });
});
