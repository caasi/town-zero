import type { ActionCommand } from "@town-zero/shared";

const VALID_TYPES = new Set(["move", "gather", "attack", "deposit", "take", "talk", "trade", "idle"]);

export function parseResponse(raw: string): ActionCommand[] {
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [{ type: "idle" }];

    const commands = parsed.filter(
      (cmd: any) => cmd && typeof cmd.type === "string" && VALID_TYPES.has(cmd.type),
    ) as ActionCommand[];

    return commands.length > 0 ? commands : [{ type: "idle" }];
  } catch {
    return [{ type: "idle" }];
  }
}
