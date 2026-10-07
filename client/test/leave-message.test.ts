import { describe, it, expect } from "vitest";
import { leaveMessage, joinErrorMessage } from "../src/leave-message.js";

describe("leaveMessage", () => {
  it("says the village is full for 4001, not that the game was updated", () => {
    expect(leaveMessage(4001)).toBe("The village is full. Try again later.");
  });

  it("says there is no village for 4000", () => {
    expect(leaveMessage(4000)).toBe("There is no village to join.");
  });

  it("gives the code and the likely cause for any other close", () => {
    expect(leaveMessage(1006)).toBe("Disconnected from the server (code 1006). The game may have been updated.");
  });
});

describe("joinErrorMessage", () => {
  it("reads the close code of a refused join", () => {
    expect(joinErrorMessage(Object.assign(new Error("Village is full"), { code: 4001 }))).toBe("The village is full. Try again later.");
  });

  it("keeps the message of any other failure", () => {
    expect(joinErrorMessage(new Error("Timed out waiting for joined message"))).toBe("Connection failed: Timed out waiting for joined message");
    expect(joinErrorMessage("boom")).toBe("Connection failed: boom");
  });
});
