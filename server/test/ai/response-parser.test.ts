import { describe, it, expect } from "vitest";
import { parseResponse } from "../../src/ai/response-parser.js";

describe("parseResponse", () => {
  it("parses valid JSON action array", () => {
    const raw = '[{"type":"move","target":{"x":6,"y":5}},{"type":"idle"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("move");
    expect(result[1].type).toBe("idle");
  });

  it("extracts JSON from markdown code block", () => {
    const raw = '```json\n[{"type":"idle"}]\n```';
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns idle on unparseable input", () => {
    const result = parseResponse("I am confused and cannot decide");
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out invalid command types", () => {
    const raw = '[{"type":"move","target":{"x":1,"y":1}},{"type":"fly","destination":"moon"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("move");
  });
});
