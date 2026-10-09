import {
  type FrameContext,
  facingTile,
  performAttackOnFacingTarget,
  performGatherOnFacingTile,
  performTalkOnFacingTarget,
  performDeposit,
  depositTarget,
} from "./facing-actions.js";
import { hasMatchingDialogueEntry } from "./dialogue-entry-predicate.js";

export function dispatchInteract(ctx: FrameContext): void {
  const { agent, agents, grid, simState } = ctx;
  const target = facingTile(agent);

  // Find an alive agent on the facing tile
  let occupant: import("./agent.js").Agent | null = null;
  for (const [, other] of agents) {
    if (!other.isAlive()) continue;
    if (other.position.x === target.x && other.position.y === target.y) {
      occupant = other;
      break;
    }
  }

  if (occupant) {
    // Rule 1 — dialogue entry match
    if (simState && hasMatchingDialogueEntry(agent, occupant, simState)) {
      performTalkOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 2 — hostile
    if (occupant.faction !== agent.faction) {
      performAttackOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 3 — same faction, no entry → falls through to deposit
  } else if (grid.getResourceAmount(target.x, target.y) > 0) {
    // Rule 4 — resource tile with units left; a used-up one is shown empty
    // (sync.ts shownYield), so it does not block deposit either
    performGatherOnFacingTile(target, ctx);
    return;
  }

  // Rule 5 — deposit when the agent stands on a housing cell, else noop. It
  // reads the cell under the agent, so it comes after every facing rule.
  const settlement = depositTarget(ctx);
  if (settlement) performDeposit(settlement, agent);
}
