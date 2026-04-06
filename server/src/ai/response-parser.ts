import type { FrameAction } from "@town-zero/shared";

const VALID_TYPES = new Set(["gather", "attack", "deposit", "take", "talk", "trade", "idle"]);
const VALID_RESOURCES = new Set(["food", "material", "currency"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  if (typeof v !== "object" || v === null) return false;
  const { x, y } = v as Record<string, unknown>;
  return typeof x === "number" && Number.isSafeInteger(x)
    && typeof y === "number" && Number.isSafeInteger(y);
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

function isValidAction(cmd: any): boolean {
  if (!cmd || typeof cmd.type !== "string" || !VALID_TYPES.has(cmd.type)) return false;

  switch (cmd.type) {
    case "gather":
      return isPosition(cmd.resourceTile);
    case "attack":
      return typeof cmd.targetId === "string";
    case "deposit":
      return typeof cmd.settlementId === "string";
    case "take":
      return typeof cmd.settlementId === "string" && VALID_RESOURCES.has(cmd.resource) && isPositiveInteger(cmd.amount);
    case "talk":
      return typeof cmd.targetId === "string";
    case "trade":
      return typeof cmd.targetId === "string"
        && VALID_RESOURCES.has(cmd.offer) && isPositiveInteger(cmd.offerAmount)
        && VALID_RESOURCES.has(cmd.want) && isPositiveInteger(cmd.wantAmount);
    case "idle":
      return true;
    default:
      return false;
  }
}

export function parseResponse(raw: string): FrameAction[] {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [{ type: "idle" }];

    const actions = parsed.filter(isValidAction) as FrameAction[];

    return actions.length > 0 ? actions : [{ type: "idle" }];
  } catch {
    return [{ type: "idle" }];
  }
}
