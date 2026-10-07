import { describe, it, expect } from "vitest";
import {
  normalizePlayerName, playerColor, randomPlayerName, playerNameKey, uniquePlayerName,
  PLAYER_NAME_MAX, PLAYER_NAME_MAX_UNITS, PLAYER_COLORS, NAME_ADJECTIVES, NAME_ANIMALS,
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

  it("bounds a name that stacks combining marks (Zalgo text)", () => {
    const zalgo = ("a" + "\u0301".repeat(5000)).repeat(20);
    const name = normalizePlayerName(zalgo)!;
    expect(name.length).toBeLessThanOrEqual(PLAYER_NAME_MAX_UNITS);
    expect(name.startsWith("a")).toBe(true);
  });

  it("removes invisible and bidi format characters but keeps emoji joins", () => {
    expect(normalizePlayerName("\u202Eabc\u2066d\u200Be")).toBe("abcde");
    const family = "👨‍👩‍👧";
    expect(normalizePlayerName(family)).toBe(family);
  });

  it("folds blank-looking letters like white space, also inside a name", () => {
    expect(normalizePlayerName("\u3164A")).toBe("A");
    expect(normalizePlayerName("A\u2800\u2800B\uFFA0")).toBe("A B");
  });

  it("rejects a name with nothing visible in it", () => {
    // Fillers and blank patterns look like nothing although they are letters or symbols.
    for (const bad of ["\u200B\u200B", "\u200D", "\u0301\u0301", "\u202E", "\u3164\u3164", "\u2800", "\uFFA0", "\u115F\u1160"]) {
      expect(normalizePlayerName(bad), JSON.stringify(bad)).toBeNull();
    }
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

  it("does not use blue (water), NPC green or enemy red", () => {
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

describe("playerNameKey", () => {
  it("treats names that differ only in case or width as the same name", () => {
    expect(playerNameKey("Quiet Otter")).toBe(playerNameKey("quiet OTTER"));
    expect(playerNameKey("Quiet Otter")).toBe(playerNameKey("\uFF31uiet \uFF2Ftter")); // full-width Q and O
    expect(playerNameKey("Quiet Otter")).not.toBe(playerNameKey("Quiet Otters"));
  });
});

describe("uniquePlayerName", () => {
  const takenBy = (...names: string[]) => (name: string) => names.map(playerNameKey).includes(playerNameKey(name));

  it("keeps a free name", () => {
    expect(uniquePlayerName("Quiet Otter", takenBy())).toBe("Quiet Otter");
  });

  it("adds the first free number to a taken name", () => {
    expect(uniquePlayerName("Quiet Otter", takenBy("quiet otter"))).toBe("Quiet Otter 2");
    expect(uniquePlayerName("Quiet Otter", takenBy("Quiet Otter", "Quiet Otter 2"))).toBe("Quiet Otter 3");
  });

  it("cuts the name so that the number still fits", () => {
    const long = "ABCDEFGHIJKLMNOP"; // 16 characters
    const name = uniquePlayerName(long, takenBy(long));
    expect(name).toBe("ABCDEFGHIJKLMN 2");
    expect(normalizePlayerName(name)).toBe(name);
  });
});
