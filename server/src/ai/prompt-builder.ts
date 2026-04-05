import type { Agent } from "../simulation/agent.js";
import type { ResourceStore } from "@town-zero/shared";

export function buildPrompt(
  agent: Agent,
  settlementInventory: ResourceStore,
  currentTick: number,
): string {
  const lines: string[] = [];

  lines.push(`You are ${agent.id}, a ${agent.role} of faction ${agent.faction}.`);
  lines.push(`Position: (${agent.position.x}, ${agent.position.y}), State: ${agent.state}`);
  lines.push(`HP: ${agent.hp}/${agent.maxHp}`);
  lines.push(`Backpack: food x${agent.inventory.food}, material x${agent.inventory.material}, currency x${agent.inventory.currency}`);
  lines.push(`Settlement inventory: food x${settlementInventory.food}, material x${settlementInventory.material}, currency x${settlementInventory.currency}`);

  const seen: string[] = [];
  const remembered: string[] = [];

  for (const [, mem] of agent.getAllMemory()) {
    if (mem.entities.length === 0) continue;
    const pos = `(${mem.entities[0].position.x}, ${mem.entities[0].position.y})`;
    const desc = mem.entities.map((e) => `${e.type} (${e.faction})`).join(", ");

    if (mem.timestamp === currentTick) {
      seen.push(`- ${pos}: ${desc}`);
    } else {
      const ticksAgo = Math.max(0, currentTick - mem.timestamp);
      remembered.push(`- ${ticksAgo} ticks ago at ${pos}: ${desc}`);
    }
  }

  if (seen.length > 0) {
    lines.push("You see:");
    lines.push(...seen);
  }

  if (remembered.length > 0) {
    lines.push("You remember:");
    lines.push(...remembered.slice(0, 5));
  }

  const beliefs = agent.getAllBeliefs();
  if (beliefs.size > 0) {
    lines.push("What you know (beliefs):");
    for (const [key, fact] of beliefs) {
      const ticksAgo = Math.max(0, currentTick - fact.tick);
      const sourceNote =
        fact.source === agent.id
          ? "your own observation"
          : `from ${fact.source}`;
      lines.push(`- ${key}: ${String(fact.value)} (${ticksAgo} ticks ago, ${sourceNote})`);
    }
  }

  lines.push("");
  lines.push("Available actions: gather, deposit, take, attack, trade, talk, idle");
  lines.push('Respond with a JSON array of FrameAction objects. Example: [{"type":"gather","resourceTile":{"x":6,"y":5}},{"type":"idle"}]');

  return lines.join("\n");
}
