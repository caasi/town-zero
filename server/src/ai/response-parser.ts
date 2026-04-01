import type { ActionCommand } from "@town-zero/shared";

const VALID_TYPES = new Set(["move", "gather", "attack", "deposit", "take", "talk", "trade", "idle"]);

function isPosition(v: unknown): v is { x: number; y: number } {
  return typeof v === "object" && v !== null && typeof (v as any).x === "number" && typeof (v as any).y === "number";
}

function isValidCommand(cmd: any): boolean {
  if (!cmd || typeof cmd.type !== "string" || !VALID_TYPES.has(cmd.type)) return false;

  switch (cmd.type) {
    case "move":
      return isPosition(cmd.target);
    case "gather":
      return isPosition(cmd.resourceTile);
    case "attack":
      return typeof cmd.targetId === "string";
    case "deposit":
      return typeof cmd.settlementId === "string";
    case "take":
      return typeof cmd.settlementId === "string" && typeof cmd.resource === "string" && typeof cmd.amount === "number";
    case "talk":
      return typeof cmd.targetId === "string" && typeof cmd.optionId === "string";
    case "trade":
      return typeof cmd.targetId === "string"
        && typeof cmd.offer === "string" && typeof cmd.offerAmount === "number"
        && typeof cmd.want === "string" && typeof cmd.wantAmount === "number";
    case "idle":
      return true;
    default:
      return false;
  }
}

export function parseResponse(raw: string): ActionCommand[] {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [{ type: "idle" }];

    const commands = parsed.filter(isValidCommand) as ActionCommand[];

    return commands.length > 0 ? commands : [{ type: "idle" }];
  } catch {
    return [{ type: "idle" }];
  }
}
