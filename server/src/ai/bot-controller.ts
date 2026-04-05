import type { InputFrame, ResourceType, Facing } from "@town-zero/shared";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";

function directionToward(from: { x: number; y: number }, to: { x: number; y: number }): Facing | null {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx > 0) return "east";
  if (dx < 0) return "west";
  if (dy > 0) return "south";
  if (dy < 0) return "north";
  return null;
}

export function decideBotAction(agent: Agent, settlement: Settlement): InputFrame[] {
  const inTerritory = settlement.isInTerritory(agent.position);

  if (agent.inventory.food <= 0) {
    if (inTerritory && settlement.inventory.food > 0) {
      return [{ seq: 0, action: { type: "take", settlementId: settlement.id, resource: "food" as ResourceType, amount: Math.min(3, settlement.inventory.food) } }];
    }
    const dir = directionToward(agent.position, settlement.territory[0]);
    if (dir) return [{ seq: 0, direction: dir }];
  }

  if (inTerritory && agent.inventory.food > 0) {
    return [{ seq: 0, action: { type: "idle" } }];
  }

  const dir = directionToward(agent.position, settlement.territory[0]);
  if (dir) return [{ seq: 0, direction: dir }];

  return [{ seq: 0, action: { type: "idle" } }];
}
