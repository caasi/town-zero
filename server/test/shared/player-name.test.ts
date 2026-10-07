import { describe, it, expect } from "vitest";
import {
  normalizePlayerName, playerColor, randomPlayerName,
  PLAYER_NAME_MAX, PLAYER_COLORS, NAME_ADJECTIVES, NAME_ANIMALS,
} from "@town-zero/shared";

const graphemes = (s: string) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length;

describe("normalizePlayerName", () => {
  it("trims and folds runs of white space", () => {
    expect(normalizePlayerName("  Quiet   Otter ")).toBe("Quiet Otter");
  });

  it("removes control characters and line breaks", () => {
    expect(normalizePlayerName("Quiet\nOtter\u0000\u2028")).toBe("Quiet Otter");
  });

  it("counts characters as a person sees them, not UTF-16 units", () => {
    const name = "卡西卡西卡西卡西卡西卡西卡西卡西"; // 16 characters
    expect(normalizePlayerName(name)).toBe(name);
    expect(normalizePlayerName(name + "卡")).toBe(name);
    const family = "👨‍👩‍👧"; // one character of 5 code points joined by ZWJ
    expect(normalizePlayerName(family.repeat(17))).toBe(family.repeat(16));
    expect(graphemes(normalizePlayerName(family.repeat(17))!)).toBe(PLAYER_NAME_MAX);
  });

  it("rejects a name that is empty after cleaning, or not a string", () => {
    for (const bad of ["", "   ", "\n\t", 42, null, undefined, {}]) {
      expect(normalizePlayerName(bad), String(bad)).toBeNull();
    }
  });
});

describe("playerColor", () => {
  it("gives the same name the same color, from the palette", () => {
    expect(playerColor("Quiet Otter")).toBe(playerColor("Quiet Otter"));
    expect(PLAYER_COLORS).toContain(playerColor("Quiet Otter"));
  });

  it("spreads names over the palette", () => {
    const used = new Set(NAME_ADJECTIVES.flatMap((a) => NAME_ANIMALS.map((n) => playerColor(`${a} ${n}`))));
    expect(used.size).toBe(PLAYER_COLORS.length);
  });

  it("does not use the colors of you, NPCs and enemies", () => {
    for (const reserved of ["#4af", "#6c6", "#c44"]) expect(PLAYER_COLORS).not.toContain(reserved);
  });
});

describe("randomPlayerName", () => {
  it("is an adjective and an animal", () => {
    expect(randomPlayerName(() => 0)).toBe(`${NAME_ADJECTIVES[0]} ${NAME_ANIMALS[0]}`);
    expect(randomPlayerName(() => 0.999)).toBe(`${NAME_ADJECTIVES[NAME_ADJECTIVES.length - 1]} ${NAME_ANIMALS[NAME_ANIMALS.length - 1]}`);
  });

  it("every combination is already a valid name", () => {
    for (const a of NAME_ADJECTIVES) for (const n of NAME_ANIMALS) {
      expect(normalizePlayerName(`${a} ${n}`)).toBe(`${a} ${n}`);
    }
  });
});
