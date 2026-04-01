import type { ActionCommand, Position } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";

function moveToward(from: Position, to: Position): Position {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx !== 0) return { x: from.x + dx, y: from.y };
  if (dy !== 0) return { x: from.x, y: from.y + dy };
  return from;
}

export function decideBotAction(agent: Agent, settlement: Settlement): ActionCommand {
  const inTerritory = settlement.isInTerritory(agent.position);

  if (agent.inventory.food <= 0) {
    if (inTerritory && settlement.inventory.food > 0) {
      return { type: "take", settlementId: settlement.id, resource: "food", amount: Math.min(3, settlement.inventory.food) };
    }
    const target = moveToward(agent.position, settlement.territory[0]);
    if (target.x !== agent.position.x || target.y !== agent.position.y) {
      return { type: "move", target };
    }
  }

  if (inTerritory && agent.inventory.food > 0) {
    return { type: "idle" };
  }

  const target = moveToward(agent.position, settlement.territory[0]);
  if (target.x !== agent.position.x || target.y !== agent.position.y) {
    return { type: "move", target };
  }

  return { type: "idle" };
}
