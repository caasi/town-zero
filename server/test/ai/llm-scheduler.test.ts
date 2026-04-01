import { describe, it, expect, vi } from "vitest";
import { LLMScheduler } from "../../src/ai/llm-scheduler.js";
import { Agent } from "../../src/simulation/agent.js";
import { Settlement } from "../../src/simulation/settlement.js";

function makeTestContext() {
  const agent = new Agent({ id: "a1", position: { x: 0, y: 0 }, faction: "v1", role: "farmer", controller: "llm" });
  const agents = new Map([["a1", agent]]);
  const settlement = new Settlement({ id: "v1", faction: "v1", type: "village", territory: [{ x: 0, y: 0 }] });
  settlement.populationIds.push("a1");
  const settlements = new Map([["v1", settlement]]);
  return { agent, agents, settlements };
}

describe("LLMScheduler", () => {
  it("skips agents that are not idle (busy gathering)", async () => {
    const callFn = vi.fn().mockResolvedValue('[]');
    const scheduler = new LLMScheduler(callFn, 0);
    const { agent, agents, settlements } = makeTestContext();

    scheduler.register("a1");
    agent.state = "gathering"; // busy, empty plan
    agent.plan = [];

    await scheduler.update(agents, settlements, 1000, 10);
    expect(callFn).not.toHaveBeenCalled();
  });

  it("skips agents that already have a plan", async () => {
    const callFn = vi.fn().mockResolvedValue('[]');
    const scheduler = new LLMScheduler(callFn, 0);
    const { agent, agents, settlements } = makeTestContext();

    scheduler.register("a1");
    agent.state = "idle";
    agent.plan = [{ type: "idle" }]; // already has a plan

    await scheduler.update(agents, settlements, 1000, 10);
    expect(callFn).not.toHaveBeenCalled();
  });

  it("calls LLM for idle agents with no plan", async () => {
    const callFn = vi.fn().mockResolvedValue('[{"type":"idle"}]');
    const scheduler = new LLMScheduler(callFn, 0);
    const { agent, agents, settlements } = makeTestContext();

    scheduler.register("a1");
    agent.state = "idle";
    agent.plan = [];

    await scheduler.update(agents, settlements, 1000, 10);
    expect(callFn).toHaveBeenCalledOnce();
  });

  it("does not retry immediately after LLM call failure", async () => {
    const callFn = vi.fn().mockRejectedValue(new Error("API error"));
    const scheduler = new LLMScheduler(callFn, 5000);
    const { agent, agents, settlements } = makeTestContext();

    scheduler.register("a1");
    agent.state = "idle";
    agent.plan = [];

    await scheduler.update(agents, settlements, 10000, 10);
    expect(callFn).toHaveBeenCalledOnce();

    // Immediately retry — should be skipped due to lastCallTime update on failure
    await scheduler.update(agents, settlements, 10001, 11);
    expect(callFn).toHaveBeenCalledOnce();
  });
});
