import { describe, it, expect } from "vitest";
import { isValidInputFrame } from "../../src/rooms/validation.js";

describe("isValidInputFrame", () => {
  it("accepts direction-only frame", () => {
    expect(isValidInputFrame({ seq: 1, direction: "north" })).toBe(true);
  });

  it("accepts action-only frame (gather)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "gather", resourceTile: { x: 1, y: 2 } } })).toBe(true);
  });

  it("accepts action-only frame (attack)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "attack", targetId: "a1" } })).toBe(true);
  });

  it("accepts action-only frame (deposit)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "deposit", settlementId: "v1" } })).toBe(true);
  });

  it("accepts action-only frame (take)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "take", settlementId: "v1", resource: "food", amount: 3 } })).toBe(true);
  });

  it("accepts action-only frame (trade)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "trade", targetId: "a2", offer: "food", offerAmount: 2, want: "material", wantAmount: 1 } })).toBe(true);
  });

  it("accepts action-only frame (talk)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "talk", targetId: "a1" } })).toBe(true);
  });

  it("accepts action-only frame (idle)", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "idle" } })).toBe(true);
  });

  it("accepts combined direction + action frame", () => {
    expect(isValidInputFrame({ seq: 1, direction: "east", action: { type: "idle" } })).toBe(true);
  });

  it("rejects frame with neither direction nor action", () => {
    expect(isValidInputFrame({ seq: 1 })).toBe(false);
  });

  it("rejects null", () => {
    expect(isValidInputFrame(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidInputFrame("north")).toBe(false);
  });

  it("rejects missing seq", () => {
    expect(isValidInputFrame({ direction: "north" })).toBe(false);
  });

  it("rejects negative seq", () => {
    expect(isValidInputFrame({ seq: -1, direction: "north" })).toBe(false);
  });

  it("rejects float seq", () => {
    expect(isValidInputFrame({ seq: 1.5, direction: "north" })).toBe(false);
  });

  it("rejects invalid direction", () => {
    expect(isValidInputFrame({ seq: 1, direction: "up" })).toBe(false);
  });

  it("rejects unknown action type", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "fly" } })).toBe(false);
  });

  it("rejects talk without targetId", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "talk" } })).toBe(false);
  });

  it("rejects take with invalid resource type", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "take", settlementId: "v1", resource: "gold", amount: 1 } })).toBe(false);
  });

  it("rejects take with non-integer amount", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "take", settlementId: "v1", resource: "food", amount: 1.5 } })).toBe(false);
  });

  it("rejects gather with non-integer coordinates", () => {
    expect(isValidInputFrame({ seq: 1, action: { type: "gather", resourceTile: { x: 2.7, y: 1 } } })).toBe(false);
  });

  it("rejects seq above Number.MAX_SAFE_INTEGER", () => {
    expect(isValidInputFrame({ seq: Number.MAX_SAFE_INTEGER + 1, direction: "north" })).toBe(false);
  });
});
