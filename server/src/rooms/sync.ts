import type { SimulationState } from "../simulation/tick.js";
import type { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { AgentSchema } from "./schemas/AgentSchema.js";
import { SettlementSchema } from "./schemas/SettlementSchema.js";
import { StructureSchema } from "./schemas/StructureSchema.js";
import { TileSchema } from "./schemas/TileSchema.js";
import type { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import type { Grid } from "../simulation/grid.js";

function syncAgent(agent: Agent, agentSchema: AgentSchema): void {
  agentSchema.id = agent.id;
  agentSchema.faction = agent.faction;
  agentSchema.role = agent.role;
  agentSchema.x = agent.position.x;
  agentSchema.y = agent.position.y;
  agentSchema.hp = agent.hp;
  agentSchema.maxHp = agent.maxHp;
  agentSchema.state = agent.state;
  agentSchema.controller = agent.controller;
  agentSchema.currentTargetId = agent.currentTargetId ?? "";
  agentSchema.inventory.set("food", agent.inventory.food);
  agentSchema.inventory.set("material", agent.inventory.material);
  agentSchema.inventory.set("currency", agent.inventory.currency);
}

function syncSettlement(settlement: Settlement, schema: SettlementSchema): void {
  schema.id = settlement.id;
  schema.faction = settlement.faction;
  schema.type = settlement.type;
  const core = settlement.structures.find((s) => s.type === "core");
  schema.x = core?.position.x ?? settlement.territory[0]?.x ?? 0;
  schema.y = core?.position.y ?? settlement.territory[0]?.y ?? 0;
  schema.population = settlement.populationIds.length;
  schema.maxPopulation = settlement.getPopulationCap();
  schema.inventory.set("food", settlement.inventory.food);
  schema.inventory.set("material", settlement.inventory.material);
  schema.inventory.set("currency", settlement.inventory.currency);

  // Rebuild structures array
  schema.structures.clear();
  for (const structure of settlement.structures) {
    const ss = new StructureSchema();
    ss.id = structure.id;
    ss.type = structure.type;
    ss.x = structure.position.x;
    ss.y = structure.position.y;
    ss.operatorId = structure.operatorId ?? "";
    schema.structures.push(ss);
  }
}

export function syncToSchema(simState: SimulationState, roomState: WorldStateSchema): void {
  roomState.tick = simState.tick;

  // Sync agents
  for (const [id, agent] of simState.agents) {
    let agentSchema = roomState.agents.get(id);
    if (!agentSchema) {
      agentSchema = new AgentSchema();
      roomState.agents.set(id, agentSchema);
    }
    syncAgent(agent, agentSchema);
  }

  // Remove agents no longer in sim (merchant despawn)
  const agentKeys: string[] = [];
  roomState.agents.forEach((_value, key) => { agentKeys.push(key); });
  for (const key of agentKeys) {
    if (!simState.agents.has(key)) {
      roomState.agents.delete(key);
    }
  }

  // Sync settlements (MVP: no settlement destruction mechanic exists,
  // so removal sync is intentionally omitted. If settlements become
  // removable, add cleanup logic mirroring agent removal above.)
  for (const [id, settlement] of simState.settlements) {
    let schema = roomState.settlements.get(id);
    if (!schema) {
      schema = new SettlementSchema();
      roomState.settlements.set(id, schema);
    }
    syncSettlement(settlement, schema);
  }
}

export function syncTiles(
  grid: Grid,
  roomState: WorldStateSchema,
  settlements?: Map<string, Settlement>,
): void {
  // Build position → structure lookup from settlements
  const structureByPos = new Map<string, { id: string; operatorId: string | null }>();
  if (settlements) {
    for (const [, settlement] of settlements) {
      for (const structure of settlement.structures) {
        const key = `${structure.position.x},${structure.position.y}`;
        structureByPos.set(key, { id: structure.id, operatorId: structure.operatorId });
      }
    }
  }

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const key = `${x},${y}`;
      const tile = new TileSchema();
      tile.x = x;
      tile.y = y;
      tile.terrain = grid.getTerrain(x, y) ?? "plains";
      tile.resourceYield = grid.getResourceYield(x, y) ?? "";
      tile.ownerFaction = grid.getOwner(x, y) ?? "";
      tile.zoneType = grid.getZoneType(x, y);
      tile.objectType = grid.getObjectType(x, y);
      const structure = structureByPos.get(key);
      tile.structureId = structure?.id ?? "";
      tile.operatorId = structure?.operatorId ?? "";
      roomState.tiles.set(key, tile);
    }
  }
}
