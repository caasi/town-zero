import { describe, it, expect } from "vitest";
import { isStaleClient } from "../src/version.js";

describe("isStaleClient", () => {
  it("is false when the server runs the build of this client", () => {
    expect(isStaleClient("abc1234", "abc1234def5678")).toBe(false);
  });

  it("is true when the server runs another build", () => {
    expect(isStaleClient("abc1234", "fff0000aaa1111")).toBe(true);
  });

  it("is true when the server sends no commit (a rollback to an older server)", () => {
    expect(isStaleClient("abc1234", undefined)).toBe(true);
  });

  it("is false for a dev build of the client", () => {
    expect(isStaleClient("dev", "abc1234def5678")).toBe(false);
  });
});
