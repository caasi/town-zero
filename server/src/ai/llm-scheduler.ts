import { LLM_CALL_INTERVAL_MS } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import { buildPrompt } from "./prompt-builder.js";
import { parseResponse } from "./response-parser.js";

export type LLMCallFn = (prompt: string) => Promise<string>;

interface ScheduleEntry {
  agentId: string;
  lastCallTime: number;
}

export class LLMScheduler {
  private schedule: ScheduleEntry[] = [];
  private callFn: LLMCallFn;
  private intervalMs: number;

  constructor(callFn: LLMCallFn, intervalMs: number = LLM_CALL_INTERVAL_MS) {
    this.callFn = callFn;
    this.intervalMs = intervalMs;
  }

  register(agentId: string): void {
    this.schedule.push({ agentId, lastCallTime: 0 });
  }

  unregister(agentId: string): void {
    this.schedule = this.schedule.filter((e) => e.agentId !== agentId);
  }

  async update(
    agents: Map<string, Agent>,
    settlements: Map<string, Settlement>,
    now: number,
    simTick: number,
  ): Promise<void> {
    for (const entry of this.schedule) {
      if (now - entry.lastCallTime < this.intervalMs) continue;

      const agent = agents.get(entry.agentId);
      if (!agent || !agent.isAlive()) continue;
      if (agent.controller !== "llm") continue;
      if (agent.state !== "idle" || agent.plan.length > 0) continue;

      const settlement = Array.from(settlements.values()).find((s) =>
        s.populationIds.includes(agent.id),
      );
      const settlementInv = settlement?.inventory ?? { food: 0, material: 0, currency: 0 };

      const prompt = buildPrompt(agent, settlementInv, simTick);

      try {
        const response = await this.callFn(prompt);
        const commands = parseResponse(response);
        agent.setPlan(commands);
        entry.lastCallTime = now;
      } catch (err) {
        entry.lastCallTime = now;
        console.error(`LLM call failed for ${entry.agentId}:`, err);
      }
    }
  }
}
