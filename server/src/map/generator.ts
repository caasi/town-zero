import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";
import { Grid } from "../simulation/grid.js";
import { Agent } from "../simulation/agent.js";
import { Settlement } from "../simulation/settlement.js";
import type { SimulationState } from "../simulation/tick.js";
import type { Position } from "@town-zero/shared";

function rect(cx: number, cy: number, r: number): Position[] {
  const result: Position[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        result.push({ x, y });
      }
    }
  }
  return result;
}

export function generateMap(): SimulationState {
  const grid = new Grid(GRID_WIDTH, GRID_HEIGHT);
  const agents = new Map<string, Agent>();
  const settlements = new Map<string, Settlement>();

  const villageCx = 10, villageCy = 20;
  const denCx = 30, denCy = 20;
  const resourceCx = 20, resourceCy = 10;

  // Terrain: forest belt
  for (let x = 18; x <= 22; x++) {
    for (let y = 15; y <= 25; y++) {
      grid.setTerrain(x, y, "forest");
    }
  }

  // Mountain patch
  for (let x = 28; x <= 32; x++) {
    for (let y = 15; y <= 17; y++) {
      grid.setTerrain(x, y, "mountain");
    }
  }

  // Water feature
  for (let x = 15; x <= 17; x++) {
    grid.setTerrain(x, 28, "water");
    grid.setTerrain(x, 29, "water");
  }

  // Trade route
  for (let x = 0; x <= villageCx; x++) {
    grid.setTerrain(x, villageCy, "road");
  }

  // Resource zone
  const resourceTiles = rect(resourceCx, resourceCy, 2);
  for (const pos of resourceTiles) {
    grid.setResourceYield(pos.x, pos.y, "food");
    grid.setTerrain(pos.x, pos.y, "plains");
  }
  for (let x = 18; x <= 20; x++) {
    grid.setResourceYield(x, 18, "material");
  }

  // Village
  const villageTerritory = rect(villageCx, villageCy, 2);
  for (const pos of villageTerritory) {
    grid.setOwner(pos.x, pos.y, "village-1");
  }

  const village = new Settlement({
    id: "village-1",
    faction: "village-1",
    type: "village",
    territory: villageTerritory,
  });
  village.addStructure({ id: "vh1", type: "housing", position: { x: villageCx, y: villageCy }, operatorId: null });
  village.addStructure({ id: "vh2", type: "housing", position: { x: villageCx + 1, y: villageCy }, operatorId: null });
  village.addStructure({ id: "vp1", type: "production", position: { x: villageCx, y: villageCy + 1 }, operatorId: null });
  village.addResource("food", 30);
  village.addResource("material", 10);
  settlements.set("village-1", village);

  const villageRoles = ["farmer", "farmer", "hunter", "scout", "worker"];
  for (let i = 0; i < villageRoles.length; i++) {
    const id = `vnpc-${i}`;
    const agent = new Agent({
      id,
      position: { x: villageCx + (i % 3) - 1, y: villageCy + Math.floor(i / 3) - 1 },
      faction: "village-1",
      role: villageRoles[i],
      controller: "llm",
    });
    agent.addToInventory("food", 5);
    agents.set(id, agent);
    village.populationIds.push(id);
  }

  // Monster den
  const denTerritory = rect(denCx, denCy, 2);
  for (const pos of denTerritory) {
    grid.setOwner(pos.x, pos.y, "den-1");
  }

  const den = new Settlement({
    id: "den-1",
    faction: "den-1",
    type: "den",
    territory: denTerritory,
  });
  den.addStructure({ id: "dh1", type: "housing", position: { x: denCx, y: denCy }, operatorId: null });
  den.addStructure({ id: "dp1", type: "production", position: { x: denCx + 1, y: denCy }, operatorId: null });
  den.addResource("food", 20);
  den.addResource("material", 5);
  settlements.set("den-1", den);

  const monsterRoles = ["beast", "beast", "beast"];
  for (let i = 0; i < monsterRoles.length; i++) {
    const id = `mnpc-${i}`;
    const agent = new Agent({
      id,
      position: { x: denCx + (i % 2), y: denCy + Math.floor(i / 2) },
      faction: "den-1",
      role: monsterRoles[i],
      controller: "llm",
    });
    agent.addToInventory("food", 3);
    agents.set(id, agent);
    den.populationIds.push(id);
  }

  return { grid, agents, settlements, tick: 0, nextMerchantId: 0 };
}
