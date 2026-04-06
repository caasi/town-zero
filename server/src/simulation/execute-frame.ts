import { TERRAIN_MOVE_COST, DIRECTION_DELTA, BASE_ATTACK_DAMAGE } from "@town-zero/shared";
import type { InputFrame, ResourceType, Facing } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import type { DialogueSession } from "../dialogue/dialogue-session.js";
import { startDialogue } from "../dialogue/session-manager.js";

export interface TalkResult {
  agentId: string;
  targetId: string;
  result: { ok: boolean; payload?: unknown; ended?: boolean; error?: string };
}

export interface FrameContext {
  grid: Grid;
  agent: Agent;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  activeSessions: Map<string, DialogueSession>;
  simState?: unknown;
  talkResults?: TalkResult[];
}

export function executeFrame(frame: InputFrame, ctx: FrameContext): void {
  const { grid, agent } = ctx;

  // Dialogue lock: reject all input while in dialogue (player or NPC side)
  if (agent.talkingToNpcId || agent.currentTalkingTo) {
    if (frame.seq > 0) agent.lastProcessedInput = Math.max(agent.lastProcessedInput, frame.seq);
    return;
  }

  if (frame.action) {
    executeAction(frame.action, ctx);
  } else if (frame.direction) {
    executeDirection(frame.direction, agent, grid);
  }

  if (frame.seq > 0) {
    agent.lastProcessedInput = Math.max(agent.lastProcessedInput, frame.seq);
  }
}

function executeDirection(direction: Facing, agent: Agent, grid: Grid): void {
  const delta = DIRECTION_DELTA[direction];
  if (!delta) return;

  // Turn-before-move
  if (direction !== agent.facing) {
    agent.facing = direction;
    return;
  }

  const target = { x: agent.position.x + delta.dx, y: agent.position.y + delta.dy };

  // Bounds + terrain check
  if (!grid.inBounds(target.x, target.y)) return;
  const terrain = grid.getTerrain(target.x, target.y);
  if (!terrain) return;
  if (TERRAIN_MOVE_COST[terrain] === Infinity) return;

  agent.position = target;
}

function facingTile(agent: Agent): { x: number; y: number } {
  const d = DIRECTION_DELTA[agent.facing];
  return { x: agent.position.x + d.dx, y: agent.position.y + d.dy };
}

function isFacingTile(agent: Agent, pos: { x: number; y: number }): boolean {
  const ft = facingTile(agent);
  return ft.x === pos.x && ft.y === pos.y;
}

function executeAction(action: NonNullable<InputFrame["action"]>, ctx: FrameContext): void {
  const { grid, agent, agents, settlements } = ctx;

  switch (action.type) {
    case "gather": {
      const resource = grid.getResourceYield(action.resourceTile.x, action.resourceTile.y);
      if (!resource) return;
      if (!isFacingTile(agent, action.resourceTile)) return;
      agent.addToInventory(resource, 1);
      break;
    }
    case "attack": {
      const target = agents.get(action.targetId);
      if (!target || !target.isAlive()) return;
      if (!grid.isAdjacent(agent.position, target.position)) return;
      target.takeDamage(BASE_ATTACK_DAMAGE);
      break;
    }
    case "deposit": {
      const settlement = settlements.get(action.settlementId);
      if (!settlement) return;
      if (!settlement.isInTerritory(agent.position)) return;
      for (const res of ["food", "material", "currency"] as ResourceType[]) {
        const amount = agent.inventory[res];
        if (amount > 0) {
          agent.removeFromInventory(res, amount);
          settlement.addResource(res, amount);
        }
      }
      break;
    }
    case "take": {
      if (!isValidAmount(action.amount)) return;
      const settlement = settlements.get(action.settlementId);
      if (!settlement) return;
      if (!settlement.isInTerritory(agent.position)) return;
      if (settlement.inventory[action.resource] < action.amount) return;
      if (settlement.removeResource(action.resource, action.amount)) {
        agent.addToInventory(action.resource, action.amount);
      }
      break;
    }
    case "trade": {
      if (!isValidAmount(action.offerAmount) || !isValidAmount(action.wantAmount)) return;
      const target = agents.get(action.targetId);
      if (!target || !target.isAlive()) return;
      if (!grid.isAdjacent(agent.position, target.position)) return;
      if (!agent.hasResource(action.offer, action.offerAmount)) return;
      if (!target.hasResource(action.want, action.wantAmount)) return;
      agent.removeFromInventory(action.offer, action.offerAmount);
      target.removeFromInventory(action.want, action.wantAmount);
      target.addToInventory(action.offer, action.offerAmount);
      agent.addToInventory(action.want, action.wantAmount);
      break;
    }
    case "talk": {
      if (ctx.simState && ctx.talkResults) {
        const talkTarget = agents.get(action.targetId);
        if (!talkTarget || !talkTarget.isAlive()) return;
        if (!isFacingTile(agent, talkTarget.position)) return;
        const result = startDialogue(agent.id, action.targetId, ctx.simState as any);
        ctx.talkResults.push({ agentId: agent.id, targetId: action.targetId, result });
      }
      break;
    }
    case "idle":
      break;
  }
}

function isValidAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}
