import type { TextTemplate, Fact, Value } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import { buildPrompt } from "../ai/prompt-builder.js";
import type { LLMCallFn } from "../ai/llm-scheduler.js";
import { interpolate, type EvalContext } from "./evaluator.js";

export async function evaluateDialogueGate(
  npc: Agent,
  player: Agent,
  requestLabel: TextTemplate,
  beliefs: ReadonlyMap<string, Fact>,
  playerName: string,
  callFn: LLMCallFn,
  settlementInventory: { food: number; material: number; currency: number },
  currentTick: number,
): Promise<boolean> {
  const makeAccessor = (agent: Agent) => ({
    get: (p: string): Value => {
      if (p === "hp") return agent.hp;
      if (p === "id") return agent.id;
      if (p === "role") return agent.role;
      if (p === "faction") return agent.faction;
      if (p in agent.inventory) return agent.inventory[p as keyof typeof agent.inventory];
      return 0;
    },
  });
  const ctx: EvalContext = {
    beliefs,
    locals: new Map(),
    agentState: {
      player: makeAccessor(player),
      npc: makeAccessor(npc),
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
  } catch (err) {
    console.error(`[dialogue-gate] LLM gate evaluation failed for NPC ${npc.id}, player ${playerName}:`, err);
    return false;
  }
}
