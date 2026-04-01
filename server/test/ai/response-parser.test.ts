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

  it("filters out move without target", () => {
    const raw = '[{"type":"move"},{"type":"idle"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("idle");
  });

  it("filters out move with non-object target", () => {
    const raw = '[{"type":"move","target":"north"}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out gather without resourceTile", () => {
    const raw = '[{"type":"gather"}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out attack without targetId", () => {
    const raw = '[{"type":"attack"}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out take without required fields", () => {
    const raw = '[{"type":"take","settlementId":"v1"}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out trade without required fields", () => {
    const raw = '[{"type":"trade","targetId":"a2"}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out take with invalid resource type", () => {
    const raw = '[{"type":"take","settlementId":"v1","resource":"gold","amount":1}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("filters out trade with invalid offer/want resource types", () => {
    const raw = '[{"type":"trade","targetId":"a2","offer":"gems","offerAmount":1,"want":"food","wantAmount":1}]';
    const result = parseResponse(raw);
    expect(result).toEqual([{ type: "idle" }]);
  });

  it("keeps well-formed commands and drops malformed ones", () => {
    const raw = '[{"type":"move","target":{"x":1,"y":1}},{"type":"attack"},{"type":"idle"}]';
    const result = parseResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("move");
    expect(result[1].type).toBe("idle");
  });
});
