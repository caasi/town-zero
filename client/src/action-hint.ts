// client/src/action-hint.ts
import { DIRECTION_DELTA, ZoneType, resolveInteract } from "@town-zero/shared";
import type { Facing, InteractKind } from "@town-zero/shared";

/** disabled: the action applies here but changes nothing (a deposit with empty hands). */
export type ActionHint = { action: InteractKind; disabled: boolean } | null;

export const HINT_LABELS: Record<InteractKind, string> = {
  talk: "Talk", attack: "Attack", gather: "Gather", deposit: "Deposit",
};

interface HintTile { resourceYield?: string; zoneType?: string }
interface HintAgent { faction: string; talkable: boolean }

/**
 * What interact will do, by the shared rules (resolveInteract). Tiles come
 * from fog snapshots. Agents come from live state: the cells read are the
 * player's own and the one in front, both always in sight.
 */
export function actionHint(
  player: { x: number; y: number; facing: Facing; faction: string; carriesAnything: boolean },
  tileAt: (x: number, y: number) => HintTile | undefined,
  agentAt: (x: number, y: number) => HintAgent | undefined,
): ActionHint {
  const d = DIRECTION_DELTA[player.facing];
  const other = agentAt(player.x + d.dx, player.y + d.dy);
  const action = resolveInteract({
    // The client cannot see entry conditions: an agent with a tree counts as one that talks.
    occupant: other ? { talks: other.talkable, sameFaction: other.faction === player.faction } : null,
    // A used-up tile is synced with resourceYield "" (sync.ts shownYield).
    resourceInFront: !!tileAt(player.x + d.dx, player.y + d.dy)?.resourceYield,
    onHousing: tileAt(player.x, player.y)?.zoneType === ZoneType.HOUSING,
  });
  if (!action) return null;
  return { action, disabled: action === "deposit" && !player.carriesAnything };
}
