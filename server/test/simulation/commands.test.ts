import { describe, it, expect } from "vitest";
import { validateCommand, executeCommand, CommandContext } from "../../src/simulation/commands.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import type { ActionCommand } from "@town-zero/shared";

function makeContext(): CommandContext {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addResource("food", 10);
  const agents = new Map<string, Agent>([["a1", agent]]);
  const settlements = new Map<string, Settlement>([["v1", settlement]]);
  return { grid, agent, agents, settlements };
}

describe("validateCommand", () => {
  it("rejects move to impassable tile", () => {
    const ctx = makeContext();
    ctx.grid.setTerrain(6, 5, "water");
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts move to passable adjacent tile", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects move to non-adjacent tile", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "move", target: { x: 8, y: 8 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects gather on tile without resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "gather", resourceTile: { x: 5, y: 5 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts gather on adjacent resource tile", () => {
    const ctx = makeContext();
    ctx.agent.position = { x: 3, y: 2 };
    const cmd: ActionCommand = { type: "gather", resourceTile: { x: 3, y: 3 } };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects gather on non-adjacent resource tile", () => {
    const ctx = makeContext();
    ctx.agent.position = { x: 5, y: 5 };
    const cmd: ActionCommand = { type: "gather", resourceTile: { x: 3, y: 3 } };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects deposit when not in settlement territory", () => {
    const ctx = makeContext();
    ctx.agent.position = { x: 0, y: 0 };
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts deposit when in settlement territory", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects take when settlement lacks resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 100 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("accepts take when settlement has resources", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 5 };
    expect(validateCommand(cmd, ctx)).toBe(true);
  });

  it("rejects attack on nonexistent target", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "attack", targetId: "nobody" };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with invalid resource type", () => {
    const ctx = makeContext();
    const cmd = { type: "take", settlementId: "v1", resource: "__proto__", amount: 1 } as any as ActionCommand;
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with negative amount", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: -1 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with zero amount", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 0 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with NaN amount", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: NaN };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with Infinity amount", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: Infinity };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects take with fractional amount", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 2.5 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects trade with negative offerAmount", () => {
    const ctx = makeContext();
    const target = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    target.addToInventory("material", 5);
    ctx.agents.set("a2", target);
    ctx.agent.addToInventory("food", 5);
    const cmd: ActionCommand = { type: "trade", targetId: "a2", offer: "food", offerAmount: -1, want: "material", wantAmount: 2 };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects trade with invalid offer resource type", () => {
    const ctx = makeContext();
    const target = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    target.addToInventory("material", 5);
    ctx.agents.set("a2", target);
    ctx.agent.addToInventory("food", 5);
    const cmd = { type: "trade", targetId: "a2", offer: "gold", offerAmount: 2, want: "material", wantAmount: 2 } as any as ActionCommand;
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects trade with invalid want resource type", () => {
    const ctx = makeContext();
    const target = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    target.addToInventory("material", 5);
    ctx.agents.set("a2", target);
    ctx.agent.addToInventory("food", 5);
    const cmd = { type: "trade", targetId: "a2", offer: "food", offerAmount: 2, want: "__proto__", wantAmount: 2 } as any as ActionCommand;
    expect(validateCommand(cmd, ctx)).toBe(false);
  });

  it("rejects trade with NaN wantAmount", () => {
    const ctx = makeContext();
    const target = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    target.addToInventory("material", 5);
    ctx.agents.set("a2", target);
    ctx.agent.addToInventory("food", 5);
    const cmd: ActionCommand = { type: "trade", targetId: "a2", offer: "food", offerAmount: 2, want: "material", wantAmount: NaN };
    expect(validateCommand(cmd, ctx)).toBe(false);
  });
});

describe("executeCommand", () => {
  it("move changes agent position when already facing that direction", () => {
    const ctx = makeContext();
    // Default facing is south, move south to actually move
    const cmd: ActionCommand = { type: "move", target: { x: 5, y: 6 } };
    executeCommand(cmd, ctx);
    expect(ctx.agent.position).toEqual({ x: 5, y: 6 });
    expect(ctx.agent.state).toBe("idle");
  });

  it("deposit transfers agent inventory to settlement", () => {
    const ctx = makeContext();
    ctx.agent.addToInventory("material", 5);
    const cmd: ActionCommand = { type: "deposit", settlementId: "v1" };
    executeCommand(cmd, ctx);
    expect(ctx.agent.inventory.material).toBe(0);
    expect(ctx.settlements.get("v1")!.inventory.material).toBe(5);
  });

  it("take transfers settlement inventory to agent", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 3 };
    executeCommand(cmd, ctx);
    expect(ctx.agent.inventory.food).toBe(3);
    expect(ctx.settlements.get("v1")!.inventory.food).toBe(7);
  });

  it("take does not credit agent when settlement debit fails", () => {
    const ctx = makeContext();
    const cmd: ActionCommand = { type: "take", settlementId: "v1", resource: "food", amount: 20 };
    executeCommand(cmd, ctx);
    expect(ctx.agent.inventory.food).toBe(0);
    expect(ctx.settlements.get("v1")!.inventory.food).toBe(10);
  });

  it("move in same facing direction moves position", () => {
    const ctx = makeContext();
    // Default facing is south, move south
    const cmd: ActionCommand = { type: "move", target: { x: 5, y: 6 } };
    executeCommand(cmd, ctx);
    expect(ctx.agent.facing).toBe("south");
    expect(ctx.agent.position).toEqual({ x: 5, y: 6 });
  });

  it("move in different facing direction only turns without moving", () => {
    const ctx = makeContext();
    // Default facing is south, move east → should only turn
    const cmd: ActionCommand = { type: "move", target: { x: 6, y: 5 } };
    executeCommand(cmd, ctx);
    expect(ctx.agent.facing).toBe("east");
    expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // didn't move
  });

  it("second move in same direction after turning moves position", () => {
    const ctx = makeContext();
    // Default facing south, move east → turn only
    executeCommand({ type: "move", target: { x: 6, y: 5 } }, ctx);
    expect(ctx.agent.facing).toBe("east");
    expect(ctx.agent.position).toEqual({ x: 5, y: 5 });
    // Now already facing east, move east → actually move
    executeCommand({ type: "move", target: { x: 6, y: 5 } }, ctx);
    expect(ctx.agent.facing).toBe("east");
    expect(ctx.agent.position).toEqual({ x: 6, y: 5 });
  });

  it("turning cycles through all four directions", () => {
    const ctx = makeContext();
    // south (default) → east
    executeCommand({ type: "move", target: { x: 6, y: 5 } }, ctx);
    expect(ctx.agent.facing).toBe("east");
    // east → north
    executeCommand({ type: "move", target: { x: 5, y: 4 } }, ctx);
    expect(ctx.agent.facing).toBe("north");
    // north → west
    executeCommand({ type: "move", target: { x: 4, y: 5 } }, ctx);
    expect(ctx.agent.facing).toBe("west");
    // west → south
    executeCommand({ type: "move", target: { x: 5, y: 6 } }, ctx);
    expect(ctx.agent.facing).toBe("south");
  });

  it("trade does not credit when offer debit fails", () => {
    const ctx = makeContext();
    const target = new Agent({ id: "a2", position: { x: 6, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
    target.addToInventory("material", 5);
    ctx.agents.set("a2", target);
    const cmd: ActionCommand = { type: "trade", targetId: "a2", offer: "food", offerAmount: 3, want: "material", wantAmount: 2 };
    executeCommand(cmd, ctx);
    expect(target.inventory.food).toBe(0);
    expect(ctx.agent.inventory.material).toBe(0);
    expect(target.inventory.material).toBe(5);
  });
});
