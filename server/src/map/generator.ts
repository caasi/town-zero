import { GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";
import { Grid } from "../simulation/grid.js";
import { Agent } from "../simulation/agent.js";
import { Settlement } from "../simulation/settlement.js";
import type { SimulationState } from "../simulation/tick.js";
import type { Position } from "@town-zero/shared";
import { stampTemplate, VILLAGE_TEMPLATE, DEN_TEMPLATE } from "./templates.js";
import { farmerReedScenario } from "../scenarios/farmer-reed.js";
import { loadScenario } from "../simulation/scenario-loader.js";

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

  // Bush tiles east of village
  const bushPositions = [
    { x: villageCx + 4, y: villageCy - 1 },
    { x: villageCx + 4, y: villageCy },
    { x: villageCx + 5, y: villageCy },
    { x: villageCx + 5, y: villageCy + 1 },
    { x: villageCx + 4, y: villageCy + 1 },
  ];
  for (const pos of bushPositions) {
    grid.setObjectType(pos.x, pos.y, "bush");
    grid.setResourceYield(pos.x, pos.y, "food");
  }

  // Village
  const villageStamp = stampTemplate(grid, VILLAGE_TEMPLATE, villageCx, villageCy, "village-1");
  const village = new Settlement({
    id: "village-1",
    faction: "village-1",
    type: "village",
    territory: villageStamp.territory,
  });
  for (const structure of villageStamp.structures) {
    village.addStructure(structure);
  }
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
  const denStamp = stampTemplate(grid, DEN_TEMPLATE, denCx, denCy, "den-1");
  const den = new Settlement({
    id: "den-1",
    faction: "den-1",
    type: "den",
    territory: denStamp.territory,
  });
  for (const structure of denStamp.structures) {
    den.addStructure(structure);
  }
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

  const state: SimulationState = { grid, agents, settlements, tick: 0, nextMerchantId: 0, activeSessions: new Map(), dialogueTrees: new Map() };

  // Load Farmer Reed scenario
  const { triggerRegistry, dialogueTrees } = loadScenario(farmerReedScenario, state);
  state.triggerRegistry = triggerRegistry;
  state.dialogueTrees = dialogueTrees;
  village.populationIds.push("farmer-reed");

  return state;
}
