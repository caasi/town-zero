import type {
  Position,
  ResourceType,
  ResourceStore,
  FSMState,
  ActionCommand,
  ControllerType,
  EntitySnapshot,
  TileMemory,
  TerrainType,
  Fact,
  DialogueProgressEntry,
} from "@town-zero/shared";
import { emptyResourceStore, DEFAULT_MAX_HP } from "@town-zero/shared";

interface AgentInit {
  id: string;
  position: Position;
  faction: string;
  role: string;
  controller: ControllerType;
  hp?: number;
}

export class Agent {
  readonly id: string;
  position: Position;
  faction: string;
  role: string;
  hp: number;
  maxHp: number;
  inventory: ResourceStore;
  state: FSMState;
  plan: ActionCommand[];
  controller: ControllerType;
  private mapMemory: Map<string, TileMemory>;
  private beliefs: Map<string, Fact> = new Map();
  private dialogueProgress: Map<string, DialogueProgressEntry> = new Map();

  // FSM execution state
  currentCommandTicks: number = 0;
  currentCommandTarget: number = 0;
  currentTargetId: string | null = null;

  constructor(init: AgentInit) {
    this.id = init.id;
    this.position = { ...init.position };
    this.faction = init.faction;
    this.role = init.role;
    this.hp = init.hp ?? DEFAULT_MAX_HP;
    this.maxHp = DEFAULT_MAX_HP;
    this.inventory = emptyResourceStore();
    this.state = "idle";
    this.plan = [];
    this.controller = init.controller;
    this.mapMemory = new Map();
  }

  addToInventory(resource: ResourceType, amount: number): void {
    this.inventory[resource] += amount;
  }

  removeFromInventory(resource: ResourceType, amount: number): boolean {
    if (this.inventory[resource] < amount) return false;
    this.inventory[resource] -= amount;
    return true;
  }

  hasResource(resource: ResourceType, amount: number): boolean {
    return this.inventory[resource] >= amount;
  }

  takeDamage(damage: number): void {
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.state = "dead";
      this.plan = [];
    }
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  setPlan(commands: ActionCommand[]): void {
    this.plan = [...commands];
  }

  clearPlan(): void {
    this.plan = [];
  }

  shiftPlan(): ActionCommand | undefined {
    return this.plan.shift();
  }

  // --- MapMemory ---

  private memoryKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  recordTile(x: number, y: number, terrain: TerrainType, entities: EntitySnapshot[], tick: number): void {
    this.mapMemory.set(this.memoryKey(x, y), { terrain, entities: [...entities], timestamp: tick });
  }

  getMemory(x: number, y: number): TileMemory | null {
    return this.mapMemory.get(this.memoryKey(x, y)) ?? null;
  }

  getAllMemory(): Map<string, TileMemory> {
    return this.mapMemory;
  }

  mergeMemory(other: Map<string, TileMemory>): void {
    for (const [key, otherMem] of other) {
      const existing = this.mapMemory.get(key);
      if (!existing || otherMem.timestamp > existing.timestamp) {
        this.mapMemory.set(key, { ...otherMem, entities: [...otherMem.entities] });
      }
    }
  }

  // --- Beliefs ---

  setBelief(key: string, fact: Fact): void {
    this.beliefs.set(key, fact);
  }

  getBelief(key: string): Fact | undefined {
    return this.beliefs.get(key);
  }

  getAllBeliefs(): Map<string, Fact> {
    return this.beliefs;
  }

  mergeBeliefs(other: Map<string, Fact>): void {
    for (const [key, fact] of other) {
      const existing = this.beliefs.get(key);
      if (!existing || fact.tick > existing.tick) {
        this.beliefs.set(key, { ...fact });
      }
    }
  }

  // --- Dialogue Progress ---

  getDialogueProgress(treeId: string): DialogueProgressEntry | undefined {
    return this.dialogueProgress.get(treeId);
  }

  setDialogueProgress(treeId: string, entry: DialogueProgressEntry): void {
    this.dialogueProgress.set(treeId, entry);
  }
}
