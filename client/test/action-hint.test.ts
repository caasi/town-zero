import { describe, it, expect } from "vitest";
import { ZoneType } from "@town-zero/shared";
import { actionHint } from "../src/action-hint.js";

// Player at (5,5) facing south; the cell in front is (5,6).
const player = { x: 5, y: 5, facing: "south" as const, faction: "v1", carriesAnything: true };
const on = (action: string) => ({ action, disabled: false });
const tiles = (map: Record<string, object>) => (x: number, y: number) => map[`${x},${y}`];
const onHousing = { "5,5": { zoneType: ZoneType.HOUSING } };
const noAgent = () => undefined;
const agent = (faction: string, talkable = false, busy = false) => (x: number, y: number) =>
  x === 5 && y === 6 ? { faction, talkable, busy } : undefined;

describe("actionHint", () => {
  it("talk for a talkable agent, also of another faction", () => {
    expect(actionHint(player, tiles(onHousing), agent("den-1", true))).toEqual(on("talk"));
  });

  it("a disabled talk to an NPC that talks to someone else", () => {
    expect(actionHint(player, tiles(onHousing), agent("v1", true, true))).toEqual({ action: "talk", disabled: true });
  });

  it("attack for an agent of another faction", () => {
    expect(actionHint(player, tiles(onHousing), agent("den-1"))).toEqual(on("attack"));
  });

  it("deposit past a same-faction agent only on a housing cell", () => {
    expect(actionHint(player, tiles(onHousing), agent("v1"))).toEqual(on("deposit"));
    expect(actionHint(player, tiles({}), agent("v1"))).toBeNull();
  });

  it("gather wins over deposit; a used-up resource does not", () => {
    expect(actionHint(player, tiles({ ...onHousing, "5,6": { resourceYield: "food" } }), noAgent)).toEqual(on("gather"));
    expect(actionHint(player, tiles({ ...onHousing, "5,6": { resourceYield: "" } }), noAgent)).toEqual(on("deposit"));
  });

  it("a disabled deposit with nothing to carry", () => {
    expect(actionHint({ ...player, carriesAnything: false }, tiles(onHousing), noAgent))
      .toEqual({ action: "deposit", disabled: true });
  });

  it("nothing on an empty cell off housing", () => {
    expect(actionHint(player, tiles({}), noAgent)).toBeNull();
  });
});
