import { describe, it, expect } from "vitest";
import { isValidActionCommand } from "../../src/rooms/validation.js";

describe("isValidActionCommand", () => {
  it("accepts valid move command", () => {
    expect(isValidActionCommand({ type: "move", target: { x: 5, y: 3 } })).toBe(true);
  });

  it("accepts valid gather command", () => {
    expect(isValidActionCommand({ type: "gather", resourceTile: { x: 1, y: 2 } })).toBe(true);
  });

  it("accepts valid attack command", () => {
    expect(isValidActionCommand({ type: "attack", targetId: "agent-1" })).toBe(true);
  });

  it("accepts valid deposit command", () => {
    expect(isValidActionCommand({ type: "deposit", settlementId: "v1" })).toBe(true);
  });

  it("accepts valid take command", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "food", amount: 3 })).toBe(true);
  });

  it("accepts valid trade command", () => {
    expect(isValidActionCommand({
      type: "trade", targetId: "a2",
      offer: "food", offerAmount: 2,
      want: "material", wantAmount: 1,
    })).toBe(true);
  });

  it("accepts valid talk command", () => {
    expect(isValidActionCommand({ type: "talk", targetId: "a1", optionId: "greet" })).toBe(true);
  });

  it("accepts valid idle command", () => {
    expect(isValidActionCommand({ type: "idle" })).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidActionCommand(null)).toBe(false);
  });

  it("rejects non-object", () => {
    expect(isValidActionCommand("move")).toBe(false);
  });

  it("rejects unknown command type", () => {
    expect(isValidActionCommand({ type: "fly" })).toBe(false);
  });

  it("rejects move without target", () => {
    expect(isValidActionCommand({ type: "move" })).toBe(false);
  });

  it("rejects move with non-numeric coordinates", () => {
    expect(isValidActionCommand({ type: "move", target: { x: "a", y: 3 } })).toBe(false);
  });

  it("rejects take with non-integer amount", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "food", amount: 1.5 })).toBe(false);
  });

  it("rejects take with invalid resource type", () => {
    expect(isValidActionCommand({ type: "take", settlementId: "v1", resource: "gold", amount: 1 })).toBe(false);
  });
});
