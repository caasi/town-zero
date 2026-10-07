import { describe, it, expect } from "vitest";
import { JOIN_REFUSED_FULL, JOIN_REFUSED_NO_VILLAGE } from "@town-zero/shared";
import { leaveMessage, joinErrorMessage } from "../src/leave-message.js";

describe("leaveMessage", () => {
  it("says the village is full for the game's own refusal code", () => {
    expect(leaveMessage(JOIN_REFUSED_FULL)).toBe("The village is full. Try again later.");
    expect(leaveMessage(JOIN_REFUSED_NO_VILLAGE)).toBe("There is no village to join.");
  });

  it("keeps the deploy text for the codes Colyseus itself uses", () => {
    // 4000 CONSENTED, 4001 SERVER_SHUTDOWN (every deploy), 4010 MAY_TRY_RECONNECT
    for (const code of [4000, 4001, 4010, 1006]) {
      expect(leaveMessage(code)).toBe(`Disconnected from the server (code ${code}). The game may have been updated.`);
    }
  });
});

describe("joinErrorMessage", () => {
  it("reads the close code of a refused join", () => {
    expect(joinErrorMessage(Object.assign(new Error("Village is full"), { code: JOIN_REFUSED_FULL }))).toBe("The village is full. Try again later.");
  });

  it("keeps the message of any other failure, a shutdown included", () => {
    expect(joinErrorMessage(Object.assign(new Error("server is shutting down"), { code: 4001 }))).toBe("Connection failed: server is shutting down");
    expect(joinErrorMessage(new Error("Timed out waiting for joined message"))).toBe("Connection failed: Timed out waiting for joined message");
    expect(joinErrorMessage("boom")).toBe("Connection failed: boom");
  });
});
