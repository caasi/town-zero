import { describe, it, expect } from "vitest";
import { executeFrame, type FrameContext } from "../../src/simulation/execute-frame.js";
import { Agent } from "../../src/simulation/agent.js";
import { Grid } from "../../src/simulation/grid.js";
import { Settlement } from "../../src/simulation/settlement.js";
import { BASE_ATTACK_DAMAGE } from "@town-zero/shared";
import type { InputFrame } from "@town-zero/shared";

function makeCtx(): FrameContext {
  const grid = new Grid(10, 10);
  grid.setResourceYield(3, 3, "food");
  grid.setResourceYield(4, 4, "material");
  const agent = new Agent({ id: "a1", position: { x: 5, y: 5 }, faction: "v1", role: "farmer", controller: "player" });
  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 5, y: 5 }, { x: 5, y: 6 }] });
  settlement.addResource("food", 10);
  const agents = new Map([["a1", agent]]);
  const settlements = new Map([["v1", settlement]]);
  const activeSessions = new Map();
  return { grid, agent, agents, settlements, activeSessions };
}

describe("executeFrame", () => {
  describe("direction only", () => {
    it("turn-before-move: changes facing when direction differs", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, direction: "east" };
      executeFrame(frame, ctx);
      expect(ctx.agent.facing).toBe("east");
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // didn't move
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("moves when already facing that direction", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, direction: "south" }; // default facing
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 6 });
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("rejects move onto impassable terrain", () => {
      const ctx = makeCtx();
      ctx.grid.setTerrain(5, 4, "water");
      ctx.agent.facing = "north";
      const frame: InputFrame = { seq: 1, direction: "north" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 });
      expect(ctx.agent.lastProcessedInput).toBe(1); // seq still advances
    });
  });

  describe("gather action", () => {
    it("instantly yields 1 resource when adjacent to resource tile", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 3, y: 2 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(1);
      expect(ctx.agent.lastProcessedInput).toBe(1);
    });

    it("yields material from material tile", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 4, y: 3 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 4, y: 4 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.material).toBe(1);
    });

    it("rejects gather when not adjacent", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 0, y: 0 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(0);
    });

    it("rejects gather when adjacent but not on facing tile", () => {
      const ctx = makeCtx();
      // Agent at (3,2) facing south → facing tile is (3,3). Resource at (4,2) is adjacent but not facing.
      ctx.agent.position = { x: 3, y: 2 };
      ctx.agent.facing = "south";
      ctx.grid.setResourceYield(2, 2, "food"); // west of agent — adjacent but not facing
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 2, y: 2 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(0);
    });

    it("rejects gather on tile without resource", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 5, y: 5 };
      const frame: InputFrame = { seq: 1, action: { type: "gather", resourceTile: { x: 5, y: 6 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(0);
    });
  });

  describe("attack action", () => {
    it("instantly deals BASE_ATTACK_DAMAGE to adjacent target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot" });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(100 - BASE_ATTACK_DAMAGE);
    });

    it("rejects attack on non-adjacent target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 8, y: 8 }, faction: "den-1", role: "beast", controller: "bot" });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(100);
    });

    it("rejects attack on dead target", () => {
      const ctx = makeCtx();
      const target = new Agent({ id: "enemy", position: { x: 5, y: 6 }, faction: "den-1", role: "beast", controller: "bot", hp: 0 });
      ctx.agents.set("enemy", target);
      const frame: InputFrame = { seq: 1, action: { type: "attack", targetId: "enemy" } };
      executeFrame(frame, ctx);
      expect(target.hp).toBe(0);
    });
  });

  describe("deposit action", () => {
    it("transfers all agent inventory to settlement", () => {
      const ctx = makeCtx();
      ctx.agent.addToInventory("material", 5);
      const frame: InputFrame = { seq: 1, action: { type: "deposit", settlementId: "v1" } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.material).toBe(0);
      expect(ctx.settlements.get("v1")!.inventory.material).toBe(5);
    });

    it("rejects deposit when not in territory", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 0, y: 0 };
      ctx.agent.addToInventory("food", 5);
      const frame: InputFrame = { seq: 1, action: { type: "deposit", settlementId: "v1" } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(5); // not deposited
    });
  });

  describe("take action", () => {
    it("transfers resource from settlement to agent", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 1, action: { type: "take", settlementId: "v1", resource: "food", amount: 3 } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(3);
      expect(ctx.settlements.get("v1")!.inventory.food).toBe(7);
    });
  });

  describe("trade action", () => {
    it("exchanges resources between agents", () => {
      const ctx = makeCtx();
      ctx.agent.addToInventory("food", 5);
      const target = new Agent({ id: "merchant", position: { x: 5, y: 6 }, faction: "merchant", role: "merchant", controller: "bot" });
      target.addToInventory("currency", 5);
      ctx.agents.set("merchant", target);
      const frame: InputFrame = { seq: 1, action: { type: "trade", targetId: "merchant", offer: "food", offerAmount: 2, want: "currency", wantAmount: 1 } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(3);
      expect(ctx.agent.inventory.currency).toBe(1);
      expect(target.inventory.food).toBe(2);
      expect(target.inventory.currency).toBe(4);
    });
  });

  describe("talk action", () => {
    it("rejects talk when target is adjacent but not on facing tile", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 5, y: 5 };
      ctx.agent.facing = "south"; // facing tile is (5,6)
      const npc = new Agent({ id: "npc-1", position: { x: 4, y: 5 }, faction: "v1", role: "farmer", controller: "llm" });
      ctx.agents.set("npc-1", npc);
      ctx.simState = {} as any;
      ctx.talkResults = [];
      const frame: InputFrame = { seq: 1, action: { type: "talk", targetId: "npc-1" } };
      executeFrame(frame, ctx);
      expect(ctx.talkResults).toHaveLength(0);
    });
  });

  describe("action priority over direction", () => {
    it("ignores direction when action is present", () => {
      const ctx = makeCtx();
      ctx.agent.position = { x: 3, y: 2 };
      ctx.agent.facing = "south";
      const frame: InputFrame = { seq: 1, direction: "east", action: { type: "gather", resourceTile: { x: 3, y: 3 } } };
      executeFrame(frame, ctx);
      expect(ctx.agent.inventory.food).toBe(1);
      expect(ctx.agent.facing).toBe("south"); // facing unchanged — direction ignored
      expect(ctx.agent.position).toEqual({ x: 3, y: 2 }); // position unchanged
    });
  });

  describe("seq handling", () => {
    it("updates lastProcessedInput for seq > 0", () => {
      const ctx = makeCtx();
      const frame: InputFrame = { seq: 5, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(5);
    });

    it("does NOT update lastProcessedInput for seq = 0 (planBacklog frame)", () => {
      const ctx = makeCtx();
      ctx.agent.lastProcessedInput = 3;
      const frame: InputFrame = { seq: 0, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(3);
    });

    it("uses Math.max — does not decrease lastProcessedInput for lower seq", () => {
      const ctx = makeCtx();
      ctx.agent.lastProcessedInput = 10;
      const frame: InputFrame = { seq: 5, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(10);
    });

    it("uses Math.max in dialogue lock path", () => {
      const ctx = makeCtx();
      ctx.activeSessions.set("npc-1", { playerId: "a1" } as any);
      ctx.agent.talkingToNpcId = "npc-1";
      ctx.agent.lastProcessedInput = 10;
      const frame: InputFrame = { seq: 5, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.lastProcessedInput).toBe(10);
    });
  });

  describe("dialogue lock", () => {
    it("rejects all frames when agent is in dialogue", () => {
      const ctx = makeCtx();
      // Simulate active dialogue session for this agent
      ctx.activeSessions.set("npc-1", { playerId: "a1" } as any);
      ctx.agent.talkingToNpcId = "npc-1";
      const frame: InputFrame = { seq: 1, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // didn't move
    });

    it("rejects frames when talkingToNpcId is set even if session already cleaned up", () => {
      const ctx = makeCtx();
      // talkingToNpcId set but no matching session (race: session expired between tick phases)
      ctx.agent.talkingToNpcId = "npc-1";
      // activeSessions is empty — session was already removed
      const frame: InputFrame = { seq: 1, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // should still block
    });

    it("rejects frames for NPC when currentTalkingTo is set", () => {
      const ctx = makeCtx();
      // NPC is the target of an active dialogue
      ctx.agent.currentTalkingTo = "player-1";
      const frame: InputFrame = { seq: 0, direction: "south" };
      executeFrame(frame, ctx);
      expect(ctx.agent.position).toEqual({ x: 5, y: 5 }); // NPC should not move
    });
  });
});
