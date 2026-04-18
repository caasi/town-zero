import type { InputFrame, ResourceType } from "@town-zero/shared";

const RESOURCE_TYPES: ReadonlySet<string> = new Set(["food", "material", "currency"]);
const VALID_DIRECTIONS = new Set(["north", "south", "east", "west"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && Number.isInteger(x)
    && typeof y === "number" && Number.isFinite(y) && Number.isInteger(y);
}

function isValidResource(v: unknown): v is ResourceType {
  return typeof v === "string" && RESOURCE_TYPES.has(v);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

function isValidAction(action: unknown): boolean {
  if (typeof action !== "object" || action === null) return false;
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case "gather": return isPosition(a.resourceTile);
    case "attack": return typeof a.targetId === "string" && a.targetId.length > 0;
    case "deposit": return typeof a.settlementId === "string" && a.settlementId.length > 0;
    case "take": return typeof a.settlementId === "string" && a.settlementId.length > 0
      && isValidResource(a.resource) && isPositiveInteger(a.amount);
    case "talk": return typeof a.targetId === "string" && a.targetId.length > 0;
    case "trade": return typeof a.targetId === "string" && a.targetId.length > 0
      && isValidResource(a.offer) && isPositiveInteger(a.offerAmount)
      && isValidResource(a.want) && isPositiveInteger(a.wantAmount);
    case "interact": return true;
    case "idle": return true;
    default: return false;
  }
}

export function isValidInputFrame(data: unknown): data is InputFrame {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.seq !== "number" || !Number.isSafeInteger(d.seq) || d.seq < 0) return false;

  const hasDirection = d.direction !== undefined;
  const hasAction = d.action !== undefined;
  if (!hasDirection && !hasAction) return false;

  if (hasDirection && !VALID_DIRECTIONS.has(d.direction as string)) return false;
  if (hasAction && !isValidAction(d.action)) return false;

  return true;
}
