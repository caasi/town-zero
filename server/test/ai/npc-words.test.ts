import { describe, it, expect } from "vitest";
import { describeGender } from "../../src/ai/npc-words.js";

describe("describeGender", () => {
  it.each([
    [{ kind: "male" } as const, "Reed is a man."],
    [{ kind: "female" } as const, "Reed is a woman."],
    [{ kind: "nonbinary" } as const, "Reed is neither a man nor a woman."],
    [{ kind: "other", description: "a spirit of the old forest" } as const, "Reed is a spirit of the old forest."],
  ])("describes %j in words for Jev", (gender, words) => {
    expect(describeGender("Reed", gender)).toBe(words);
  });
});
