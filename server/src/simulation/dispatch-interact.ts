import {
  type FrameContext,
  facingTile,
  performAttackOnFacingTarget,
  performGatherOnFacingTile,
  performTalkOnFacingTarget,
} from "./facing-actions.js";
import { hasMatchingDialogueEntry } from "./dialogue-entry-predicate.js";

export function dispatchInteract(ctx: FrameContext): void {
  const { agent, agents, grid, simState } = ctx;
  const target = facingTile(agent);
  if (!grid.inBounds(target.x, target.y)) return;

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
    // Rule 1 — merchant: server-side noop. Client handles modal locally.
    if (occupant.role === "merchant") return;

    // Rule 2 — dialogue entry match
    if (simState && hasMatchingDialogueEntry(agent, occupant, simState)) {
      performTalkOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 3 — hostile
    if (occupant.faction !== agent.faction) {
      performAttackOnFacingTarget(occupant.id, ctx);
      return;
    }

    // Rule 4 — same faction, no entry → noop
    return;
  }

  // Rule 5 — resource tile
  if (grid.getResourceYield(target.x, target.y)) {
    performGatherOnFacingTile(target, ctx);
    return;
  }

  // Rule 6 — empty → noop
}
