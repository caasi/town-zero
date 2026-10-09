import { describe, it, expect } from "vitest";
import { resolveInteract } from "@town-zero/shared";

const facts = (over: Partial<Parameters<typeof resolveInteract>[0]> = {}) =>
  resolveInteract({ occupant: null, resourceInFront: false, onHousing: false, ...over });

describe("resolveInteract", () => {
  it("talk wins over attack; an enemy without talk is attacked", () => {
    expect(facts({ occupant: { talks: true, sameFaction: false } })).toBe("talk");
    expect(facts({ occupant: { talks: false, sameFaction: false }, onHousing: true })).toBe("attack");
  });

  it("a same-faction agent without talk falls through to deposit", () => {
    expect(facts({ occupant: { talks: false, sameFaction: true }, onHousing: true })).toBe("deposit");
    expect(facts({ occupant: { talks: false, sameFaction: true } })).toBeNull();
  });

  it("an agent in front hides the resource under it", () => {
    expect(facts({ occupant: { talks: false, sameFaction: true }, resourceInFront: true })).toBeNull();
  });

  it("gather wins over deposit; deposit only on housing", () => {
    expect(facts({ resourceInFront: true, onHousing: true })).toBe("gather");
    expect(facts({ onHousing: true })).toBe("deposit");
    expect(facts()).toBeNull();
  });
});
