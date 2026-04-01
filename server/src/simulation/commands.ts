import type { ActionCommand, ResourceType } from "@town-zero/shared";
import { TERRAIN_MOVE_COST } from "@town-zero/shared";
import type { Agent } from "./agent.js";
import type { Grid } from "./grid.js";
import type { Settlement } from "./settlement.js";

export interface CommandContext {
  grid: Grid;
  agent: Agent;
  agents: Map<string, Agent>;
  settlements: Map<string, Settlement>;
}

function isValidAmount(n: number): boolean {
  return Number.isFinite(n) && n > 0 && Number.isInteger(n);
}

export function validateCommand(cmd: ActionCommand, ctx: CommandContext): boolean {
  const { grid, agent, agents, settlements } = ctx;

  switch (cmd.type) {
    case "move": {
      const terrain = grid.getTerrain(cmd.target.x, cmd.target.y);
      if (!terrain) return false;
      if (TERRAIN_MOVE_COST[terrain] === Infinity) return false;
      if (!grid.isAdjacent(agent.position, cmd.target)) return false;
      return true;
    }
    case "gather": {
      const resource = grid.getResourceYield(cmd.resourceTile.x, cmd.resourceTile.y);
      if (!resource) return false;
      if (agent.position.x !== cmd.resourceTile.x || agent.position.y !== cmd.resourceTile.y) return false;
      return true;
    }
    case "deposit": {
      const settlement = settlements.get(cmd.settlementId);
      if (!settlement) return false;
      if (!settlement.isInTerritory(agent.position)) return false;
      return true;
    }
    case "take": {
      if (!isValidAmount(cmd.amount)) return false;
      const settlement = settlements.get(cmd.settlementId);
      if (!settlement) return false;
      if (!settlement.isInTerritory(agent.position)) return false;
      if (settlement.inventory[cmd.resource] < cmd.amount) return false;
      return true;
    }
    case "attack": {
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      return true;
    }
    case "trade": {
      if (!isValidAmount(cmd.offerAmount) || !isValidAmount(cmd.wantAmount)) return false;
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      if (!agent.hasResource(cmd.offer, cmd.offerAmount)) return false;
      if (!target.hasResource(cmd.want, cmd.wantAmount)) return false;
      return true;
    }
    case "talk": {
      const target = agents.get(cmd.targetId);
      if (!target || !target.isAlive()) return false;
      if (!grid.isAdjacent(agent.position, target.position)) return false;
      return true;
    }
    case "idle":
      return true;
    default:
      return false;
  }
}

export function executeCommand(cmd: ActionCommand, ctx: CommandContext): void {
  const { agent, agents, settlements } = ctx;

  switch (cmd.type) {
    case "move":
      agent.position = { ...cmd.target };
      break;
    case "deposit": {
      const settlement = settlements.get(cmd.settlementId)!;
      for (const res of ["food", "material", "currency"] as ResourceType[]) {
        const amount = agent.inventory[res];
        if (amount > 0) {
          agent.removeFromInventory(res, amount);
          settlement.addResource(res, amount);
        }
      }
      break;
    }
    case "take": {
      const settlement = settlements.get(cmd.settlementId)!;
      settlement.removeResource(cmd.resource, cmd.amount);
      agent.addToInventory(cmd.resource, cmd.amount);
      break;
    }
    case "trade": {
      const target = agents.get(cmd.targetId)!;
      agent.removeFromInventory(cmd.offer, cmd.offerAmount);
      target.addToInventory(cmd.offer, cmd.offerAmount);
      target.removeFromInventory(cmd.want, cmd.wantAmount);
      agent.addToInventory(cmd.want, cmd.wantAmount);
      break;
    }
    case "idle":
      break;
    // gather, attack, talk handled by tick system (multi-tick)
  }
}
