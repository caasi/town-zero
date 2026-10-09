import { DIRECTION_DELTA, BASE_ATTACK_DAMAGE, ZoneType } from "@town-zero/shared";
import type { ResourceType } from "@town-zero/shared";
import { applyDamage } from "./apply-damage.js";
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
  if (!ctx.simState) { target.takeDamage(BASE_ATTACK_DAMAGE); return; }
  applyDamage(target, BASE_ATTACK_DAMAGE, agent, ctx.simState);
}

export function performGatherOnFacingTile(resourceTile: Position, ctx: FrameContext): void {
  const { agent, grid } = ctx;
  if (!isFacingTile(agent, resourceTile)) return;
  const resource = grid.takeResource(resourceTile.x, resourceTile.y);
  if (resource) agent.addToInventory(resource, 1);
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

/** Moves all resources but `keepFood` food from the agent into the settlement. */
export function performDeposit(settlement: Settlement, agent: Agent, keepFood = 0): void {
  for (const res of ["food", "material", "currency"] as ResourceType[]) {
    const keep = res === "food" ? keepFood : 0;
    const amount = agent.inventory[res] - keep;
    if (amount > 0) {
      agent.removeFromInventory(res, amount);
      settlement.addResource(res, amount);
    }
  }
}

/** The settlement whose housing cell the agent stands on, of any faction. */
export function depositTarget(ctx: FrameContext): Settlement | null {
  const { agent, grid, settlements } = ctx;
  if (grid.getZoneType(agent.position.x, agent.position.y) !== ZoneType.HOUSING) return null;
  for (const s of settlements.values()) {
    if (s.isInTerritory(agent.position)) return s;
  }
  return null;
}
