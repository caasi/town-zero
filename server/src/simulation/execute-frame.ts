import { DIRECTION_DELTA, isMoveBlocked } from "@town-zero/shared";
import type { InputFrame, Facing } from "@town-zero/shared";
import { dispatchInteract } from "./dispatch-interact.js";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import {
  type FrameContext,
  type TalkResult,
  performAttackOnFacingTarget,
  performGatherOnFacingTile,
  performTalkOnFacingTarget,
  performDeposit,
} from "./facing-actions.js";

export type { FrameContext, TalkResult };
export {
  performAttackOnFacingTarget,
  performGatherOnFacingTile,
  performTalkOnFacingTarget,
};

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

  if (isMoveBlocked(target.x, target.y, grid, grid.getTerrain(target.x, target.y))) return;

  agent.position = target;
}

function executeAction(action: NonNullable<InputFrame["action"]>, ctx: FrameContext): void {
  const { grid, agent, agents, settlements } = ctx;

  switch (action.type) {
    case "interact": {
      dispatchInteract(ctx);
      break;
    }
    case "gather": {
      performGatherOnFacingTile(action.resourceTile, ctx);
      break;
    }
    case "attack": {
      performAttackOnFacingTarget(action.targetId, ctx);
      break;
    }
    case "deposit": {
      const settlement = settlements.get(action.settlementId);
      if (!settlement) return;
      if (!settlement.isInTerritory(agent.position)) return;
      performDeposit(settlement, agent, action.keepFood);
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
    case "talk": {
      performTalkOnFacingTarget(action.targetId, ctx);
      break;
    }
    case "idle":
      break;
  }
}

function isValidAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}
