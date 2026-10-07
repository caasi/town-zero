import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { expectCleanName } from "./name-invariants.js";

// The Big List of Naughty Strings (MIT, github.com/minimaxir/big-list-of-naughty-strings):
// strings known to break software, as test input. Not a filter: the rules are by
// Unicode category, so strings outside this list are covered too.
const naughty: string[] = JSON.parse(readFileSync(new URL("../fixtures/blns.json", import.meta.url), "utf8"));

describe("normalizePlayerName on the Big List of Naughty Strings", () => {
  it("gives a clean name or null for every string", () => {
    for (const raw of naughty) expectCleanName(raw);
  });
});
