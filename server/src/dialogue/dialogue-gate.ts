import type { TextTemplate, Fact, Value } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import { buildPrompt } from "../ai/prompt-builder.js";
import type { LLMCallFn } from "../ai/llm-scheduler.js";
import { interpolate, type EvalContext } from "./evaluator.js";

export async function evaluateDialogueGate(
  npc: Agent,
  requestLabel: TextTemplate,
  beliefs: ReadonlyMap<string, Fact>,
  playerName: string,
  callFn: LLMCallFn,
  settlementInventory: { food: number; material: number; currency: number },
  currentTick: number,
): Promise<boolean> {
  const ctx: EvalContext = {
    beliefs,
    locals: new Map(),
    agentState: {
      player: { get: () => 0 },
      npc: {
        get: (p: string) =>
          (p in npc.inventory
            ? npc.inventory[p as keyof typeof npc.inventory]
            : 0) as Value,
      },
      settlement: null,
    },
    currentTick,
  };
  const labelText = interpolate(requestLabel, ctx);

  const basePrompt = buildPrompt(npc, settlementInventory, currentTick);
  const gatePrompt = [
    basePrompt,
    "",
    `Player ${playerName} requests: "${labelText}"`,
    "Given your current situation, will you agree? Reply y or n.",
  ].join("\n");

  try {
    const response = await callFn(gatePrompt);
    const answer = response.trim().toLowerCase();
    return answer.startsWith("y");
  } catch {
    return false;
  }
}
