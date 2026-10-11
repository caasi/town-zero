import { DIRECTION_DELTA, ZoneType, resolveInteract } from "@town-zero/shared";
import type { Facing, InteractKind } from "@town-zero/shared";

export type ActionHint = { action: InteractKind; disabled: boolean } | null;

export const HINT_LABELS: Record<InteractKind, string> = {
  talk: "Talk", attack: "Attack", gather: "Gather", deposit: "Deposit",
};

interface HintTile { resourceYield?: string; zoneType?: string }
interface HintAgent { faction: string; talkable: boolean; busy: boolean }

export function actionHint(
  player: { x: number; y: number; facing: Facing; faction: string; carriesAnything: boolean },
  tileAt: (x: number, y: number) => HintTile | undefined,
  agentAt: (x: number, y: number) => HintAgent | undefined,
): ActionHint {
  const d = DIRECTION_DELTA[player.facing];
  const other = agentAt(player.x + d.dx, player.y + d.dy);
  const action = resolveInteract({
    occupant: other ? { talks: other.talkable, sameFaction: other.faction === player.faction } : null,
    resourceInFront: !!tileAt(player.x + d.dx, player.y + d.dy)?.resourceYield,
    onHousing: tileAt(player.x, player.y)?.zoneType === ZoneType.HOUSING,
  });
  if (!action) return null;
  const disabled = action === "deposit" ? !player.carriesAnything : action === "talk" && !!other?.busy;
  return { action, disabled };
}
