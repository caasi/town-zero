import { describe, it, expect } from "vitest";
import { t, fact, player, local } from "@town-zero/shared/script-dsl";

describe("tagged template t", () => {
  it("plain string produces single-element array", () => {
    const tpl = t`Hello world`;
    expect(tpl).toEqual(["Hello world"]);
  });

  it("interpolates ExprBuilder into TextTemplate", () => {
    const tpl = t`Hello ${fact("name")}!`;
    expect(tpl).toEqual([
      "Hello ",
      { type: "fact_ref", key: "name" },
      "!",
    ]);
  });

  it("multiple interpolations", () => {
    const tpl = t`${player.prop("food")} food and ${local("cost")} cost`;
    expect(tpl).toEqual([
      { type: "prop_ref", target: "player", prop: "food" },
      " food and ",
      { type: "local_ref", key: "cost" },
      " cost",
    ]);
  });

  it("filters out empty strings at start/end", () => {
    const tpl = t`Hello world`;
    expect(tpl.every((part) => part !== "")).toBe(true);
  });

  it("adjacent expressions have empty string between them", () => {
    const tpl = t`${fact("a")}${fact("b")}`;
    expect(tpl).toEqual([
      { type: "fact_ref", key: "a" },
      { type: "fact_ref", key: "b" },
    ]);
  });
});
