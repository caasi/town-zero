import type { Agent } from "../simulation/agent.js";
import { buildPrompt } from "../ai/prompt-builder.js";
import type { LLMCallFn } from "../ai/llm-scheduler.js";

export async function evaluateDialogueGate(
  npc: Agent,
  requestLabel: string,
  playerName: string,
  callFn: LLMCallFn,
  settlementInventory: { food: number; material: number; currency: number },
  currentTick: number,
): Promise<boolean> {
  const basePrompt = buildPrompt(npc, settlementInventory, currentTick);
  const gatePrompt = [
    basePrompt,
    "",
    `Player ${playerName} requests: "${requestLabel}"`,
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
