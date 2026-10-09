// client/src/action-hint.ts
import { DIRECTION_DELTA, ZoneType } from "@town-zero/shared";
import type { Facing } from "@town-zero/shared";

export type HintAction = "talk" | "attack" | "gather" | "deposit";
/** disabled: the action applies here but changes nothing (a deposit with empty hands). */
export type ActionHint = { action: HintAction; disabled: boolean } | null;

export const HINT_LABELS: Record<HintAction, string> = {
  talk: "Talk", attack: "Attack", gather: "Gather", deposit: "Deposit",
};

interface HintTile { resourceYield?: string; zoneType?: string }
interface HintAgent { faction: string; talkable: boolean }

/**
 * What interact will do, by the rules of server dispatchInteract. Tiles come
 * from fog snapshots. Agents come from live state: the cells read are the
 * player's own and the one in front, both always in sight.
 */
export function actionHint(
  player: { x: number; y: number; facing: Facing; faction: string; carriesAnything: boolean },
  tileAt: (x: number, y: number) => HintTile | undefined,
  agentAt: (x: number, y: number) => HintAgent | undefined,
): ActionHint {
  const d = DIRECTION_DELTA[player.facing];
  const fx = player.x + d.dx;
  const fy = player.y + d.dy;
  const deposit: ActionHint = tileAt(player.x, player.y)?.zoneType === ZoneType.HOUSING
    ? { action: "deposit", disabled: !player.carriesAnything }
    : null;

  const other = agentAt(fx, fy);
  if (other) {
    if (other.talkable) return { action: "talk", disabled: false };
    if (other.faction !== player.faction) return { action: "attack", disabled: false };
    return deposit;
  }
  if (tileAt(fx, fy)?.resourceYield) return { action: "gather", disabled: false };
  return deposit;
}
