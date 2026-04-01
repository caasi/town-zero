import type { Position, ResourceType, ResourceStore, SettlementType, StructureType } from "@town-zero/shared";
import { emptyResourceStore, HOUSING_POPULATION_CAP } from "@town-zero/shared";

export interface Structure {
  id: string;
  type: StructureType;
  position: Position;
  operatorId: string | null;
}

interface SettlementInit {
  id: string;
  faction: string;
  type: SettlementType;
  territory: Position[];
}

export class Settlement {
  readonly id: string;
  readonly faction: string;
  readonly type: SettlementType;
  inventory: ResourceStore;
  territory: Position[];
  structures: Structure[];
  populationIds: string[]; // agent IDs that belong to this settlement

  constructor(init: SettlementInit) {
    this.id = init.id;
    this.faction = init.faction;
    this.type = init.type;
    this.inventory = emptyResourceStore();
    this.territory = [...init.territory];
    this.structures = [];
    this.populationIds = [];
  }

  isInTerritory(pos: Position): boolean {
    return this.territory.some((t) => t.x === pos.x && t.y === pos.y);
  }

  addStructure(structure: Structure): void {
    this.structures.push(structure);
  }

  getPopulationCap(): number {
    return this.structures.filter((s) => s.type === "housing").length * HOUSING_POPULATION_CAP;
  }

  getProductionStructures(): Structure[] {
    return this.structures.filter((s) => s.type === "production");
  }

  addResource(resource: ResourceType, amount: number): void {
    this.inventory[resource] += amount;
  }

  removeResource(resource: ResourceType, amount: number): boolean {
    if (this.inventory[resource] < amount) return false;
    this.inventory[resource] -= amount;
    return true;
  }
}
