import { resolveInteract } from "@town-zero/shared";
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
import type { Agent } from "./agent.js";

/** Gathers the facts for the shared interact rules (resolveInteract), then acts. */
export function dispatchInteract(ctx: FrameContext): void {
  const { agent, agents, grid, simState } = ctx;
  const target = facingTile(agent);

  let occupant: Agent | null = null;
  for (const [, other] of agents) {
    if (other.isAlive() && other.position.x === target.x && other.position.y === target.y) {
      occupant = other;
      break;
    }
  }
  const settlement = depositTarget(ctx);

  const kind = resolveInteract({
    occupant: occupant && {
      talks: !!simState && hasMatchingDialogueEntry(agent, occupant, simState),
      sameFaction: occupant.faction === agent.faction,
    },
    resourceInFront: grid.getResourceAmount(target.x, target.y) > 0,
    onHousing: settlement !== null,
  });

  switch (kind) {
    case "talk": performTalkOnFacingTarget(occupant!.id, ctx); break;
    case "attack": performAttackOnFacingTarget(occupant!.id, ctx); break;
    case "gather": performGatherOnFacingTile(target, ctx); break;
    case "deposit": performDeposit(settlement!, agent); break;
  }
}
