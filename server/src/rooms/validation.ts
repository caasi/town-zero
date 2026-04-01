import type { ActionCommand, ResourceType } from "@town-zero/shared";

const RESOURCE_TYPES: ReadonlySet<string> = new Set(["food", "material", "currency"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  return typeof v === "object" && v !== null
    && typeof (v as Record<string, unknown>).x === "number"
    && typeof (v as Record<string, unknown>).y === "number";
}

function isValidResource(v: unknown): v is ResourceType {
  return typeof v === "string" && RESOURCE_TYPES.has(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

export function isValidActionCommand(cmd: unknown): cmd is ActionCommand {
  if (typeof cmd !== "object" || cmd === null) return false;
  const c = cmd as Record<string, unknown>;

  switch (c.type) {
    case "move":
      return isPosition(c.target);
    case "gather":
      return isPosition(c.resourceTile);
    case "attack":
      return typeof c.targetId === "string" && c.targetId.length > 0;
    case "deposit":
      return typeof c.settlementId === "string" && c.settlementId.length > 0;
    case "take":
      return typeof c.settlementId === "string" && c.settlementId.length > 0
        && isValidResource(c.resource) && isPositiveInteger(c.amount);
    case "talk":
      return typeof c.targetId === "string" && c.targetId.length > 0
        && typeof c.optionId === "string";
    case "trade":
      return typeof c.targetId === "string" && c.targetId.length > 0
        && isValidResource(c.offer) && isPositiveInteger(c.offerAmount)
        && isValidResource(c.want) && isPositiveInteger(c.wantAmount);
    case "idle":
      return true;
    default:
      return false;
  }
}
