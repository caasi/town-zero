import { expect } from "vitest";
import { normalizePlayerName, PLAYER_NAME_MAX, PLAYER_NAME_MAX_UNITS } from "@town-zero/shared";

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;

/** What every cleaned name must be, whatever came in. */
export function expectCleanName(raw: string): void {
  const name = normalizePlayerName(raw);
  if (name === null) return;
  expect(graphemes(name), JSON.stringify(raw)).toBeLessThanOrEqual(PLAYER_NAME_MAX);
  expect(name.length, JSON.stringify(raw)).toBeLessThanOrEqual(PLAYER_NAME_MAX_UNITS);
  expect(name, JSON.stringify(raw)).not.toMatch(/[\p{Cc}\u2028\u2029]|(?!\u200D)\p{Cf}/u);
  expect(name, JSON.stringify(raw)).toBe(name.trim());
  expect(normalizePlayerName(name), "cleaning twice changes nothing").toBe(name);
}
