import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { expectCleanName } from "./name-invariants.js";

const naughty: string[] = JSON.parse(readFileSync(new URL("../fixtures/blns.json", import.meta.url), "utf8"));

describe("normalizePlayerName on the Big List of Naughty Strings", () => {
  it("gives a clean name or null for every string", () => {
    for (const raw of naughty) expectCleanName(raw);
  });
});
