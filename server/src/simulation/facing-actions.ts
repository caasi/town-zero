import { DIRECTION_DELTA, BASE_ATTACK_DAMAGE } from "@town-zero/shared";
import type { Position } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";
import type { DialogueSession } from "../dialogue/dialogue-session.js";
import { startDialogue, type DialogueResult } from "../dialogue/session-manager.js";
import type { SimulationState } from "./tick.js";

export interface TalkResult {
  agentId: string;
  targetId: string;
  result: DialogueResult;
}

export interface FrameContext {
  grid: Grid;
  agent: Agent;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
  activeSessions: Map<string, DialogueSession>;
  simState?: SimulationState;
  talkResults?: TalkResult[];
}

export function facingTile(agent: Agent): { x: number; y: number } {
  const d = DIRECTION_DELTA[agent.facing];
  return { x: agent.position.x + d.dx, y: agent.position.y + d.dy };
}

export function isFacingTile(agent: Agent, pos: { x: number; y: number }): boolean {
  const ft = facingTile(agent);
  return ft.x === pos.x && ft.y === pos.y;
}

export function performAttackOnFacingTarget(targetId: string, ctx: FrameContext): void {
  const { agent, agents } = ctx;
  const target = agents.get(targetId);
  if (!target || !target.isAlive()) return;
  if (!isFacingTile(agent, target.position)) return;
  target.takeDamage(BASE_ATTACK_DAMAGE);
}

export function performGatherOnFacingTile(resourceTile: Position, ctx: FrameContext): void {
  const { agent, grid } = ctx;
  const resource = grid.getResourceYield(resourceTile.x, resourceTile.y);
  if (!resource) return;
  if (!isFacingTile(agent, resourceTile)) return;
  agent.addToInventory(resource, 1);
}

export function performTalkOnFacingTarget(targetId: string, ctx: FrameContext): void {
  const { agent, agents } = ctx;
  if (ctx.simState && ctx.talkResults) {
    const talkTarget = agents.get(targetId);
    if (!talkTarget || !talkTarget.isAlive()) return;
    if (!isFacingTile(agent, talkTarget.position)) return;
    const result = startDialogue(agent.id, targetId, ctx.simState);
    ctx.talkResults.push({ agentId: agent.id, targetId, result });
  }
}
