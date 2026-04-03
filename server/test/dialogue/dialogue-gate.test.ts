import { describe, it, expect } from "vitest";
import { evaluateDialogueGate } from "../../src/dialogue/dialogue-gate.js";
import { Agent } from "../../src/simulation/agent.js";
import type { TextTemplate, Fact } from "@town-zero/shared";

function makeTestAgent(): Agent {
  return new Agent({
    id: "npc-1",
    position: { x: 0, y: 0 },
    faction: "village",
    role: "merchant",
    controller: "npc",
  });
}

describe("evaluateDialogueGate", () => {
  it("returns true when LLM responds 'y'", async () => {
    const mockLLM = async (_prompt: string) => "y";
    const label: TextTemplate = ["Can I trade?"];
    const beliefs = new Map<string, Fact>();

    const result = await evaluateDialogueGate(
      makeTestAgent(),
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(result).toBe(true);
  });

  it("returns false when LLM responds 'n'", async () => {
    const mockLLM = async (_prompt: string) => "n";
    const label: TextTemplate = ["Can I trade?"];
    const beliefs = new Map<string, Fact>();

    const result = await evaluateDialogueGate(
      makeTestAgent(),
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(result).toBe(false);
  });

  it("returns false when LLM throws", async () => {
    const mockLLM = async (_prompt: string): Promise<string> => {
      throw new Error("LLM down");
    };
    const label: TextTemplate = ["Can I trade?"];
    const beliefs = new Map<string, Fact>();

    const result = await evaluateDialogueGate(
      makeTestAgent(),
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(result).toBe(false);
  });

  it("interpolates TextTemplate label in the prompt", async () => {
    let capturedPrompt = "";
    const mockLLM = async (prompt: string) => {
      capturedPrompt = prompt;
      return "y";
    };

    const label: TextTemplate = [
      "Trade ",
      { type: "fact_ref", key: "item_name" },
      " for food",
    ];
    const beliefs = new Map<string, Fact>([
      ["item_name", { key: "item_name", value: "木材", tick: 1, source: "a" }],
    ]);

    await evaluateDialogueGate(
      makeTestAgent(),
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(capturedPrompt).toContain("Trade 木材 for food");
  });

  it("interpolates prop_ref from npc inventory in TextTemplate", async () => {
    let capturedPrompt = "";
    const mockLLM = async (prompt: string) => {
      capturedPrompt = prompt;
      return "y";
    };

    const npc = makeTestAgent();
    npc.addToInventory("food", 42);

    const label: TextTemplate = [
      "Give me ",
      { type: "prop_ref", target: "npc", prop: "food" },
      " food",
    ];
    const beliefs = new Map<string, Fact>();

    await evaluateDialogueGate(
      npc,
      label,
      beliefs,
      "player1",
      mockLLM,
      { food: 0, material: 0, currency: 0 },
      10,
    );

    expect(capturedPrompt).toContain("Give me 42 food");
  });
});
