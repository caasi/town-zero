import type { ActionCommand } from "@town-zero/shared";
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

const VALID_RESOURCE_TYPES = new Set(["food", "material", "currency"]);

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
      if (!VALID_RESOURCE_TYPES.has(cmd.resource)) return false;
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
      if (settlement.removeResource(cmd.resource, cmd.amount)) {
        agent.addToInventory(cmd.resource, cmd.amount);
      }
      break;
    }
    case "trade": {
      const target = agents.get(cmd.targetId)!;
      const offerOk = agent.removeFromInventory(cmd.offer, cmd.offerAmount);
      const wantOk = target.removeFromInventory(cmd.want, cmd.wantAmount);
      if (offerOk) target.addToInventory(cmd.offer, cmd.offerAmount);
      if (wantOk) agent.addToInventory(cmd.want, cmd.wantAmount);
      // Rollback on partial failure
      if (offerOk && !wantOk) {
        agent.addToInventory(cmd.offer, cmd.offerAmount);
        target.removeFromInventory(cmd.offer, cmd.offerAmount);
      }
      if (!offerOk && wantOk) {
        target.addToInventory(cmd.want, cmd.wantAmount);
        agent.removeFromInventory(cmd.want, cmd.wantAmount);
      }
      break;
    }
    case "idle":
      break;
    // gather, attack, talk handled by tick system (multi-tick)
  }
}
