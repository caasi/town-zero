import { describe, it } from "vitest";
import fc from "fast-check";
import { expectCleanName } from "./name-invariants.js";

describe("normalizePlayerName (property)", () => {
  it("gives a clean name or null for any string", () => {
    // Full Unicode, plus runs of marks, joiners and format characters, which
    // random code points seldom put together.
    const tricky = fc.constantFrom("\u0301", "\u200D", "\u200B", "\u202E", "\u3164", "\uFE0F", "\n", " ", "a", "卡", "👨");
    const raw = fc.oneof(
      fc.string({ unit: "grapheme", maxLength: 60 }),
      fc.string({ unit: "binary", maxLength: 300 }),
      fc.array(tricky, { maxLength: 400 }).map((xs) => xs.join("")),
    );
    fc.assert(fc.property(raw, (s) => { expectCleanName(s); }), { numRuns: 2000 });
  });
});
