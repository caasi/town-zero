import type {
  Position,
  ResourceType,
  ResourceStore,
  FSMState,
  ControllerType,
  EntitySnapshot,
  TileMemory,
  TerrainType,
  Facing,
  Fact,
  DialogueProgressEntry,
  InputFrame,
} from "@town-zero/shared";
import { emptyResourceStore, DEFAULT_MAX_HP, INPUT_QUEUE_CAP } from "@town-zero/shared";

const BUBBLE_MAX_LEN = 64;

interface AgentInit {
  id: string;
  name?: string;
  position: Position;
  faction: string;
  role: string;
  controller: ControllerType;
  hp?: number;
  facing?: Facing;
}

export class Agent {
  readonly id: string;
  name: string;
  position: Position;
  faction: string;
  role: string;
  facing: Facing;
  hp: number;
  maxHp: number;
  inventory: ResourceStore;
  state: FSMState;
  controller: ControllerType;
  private mapMemory: Map<string, TileMemory>;
  private beliefs: Map<string, Fact> = new Map();
  private dialogueProgress: Map<string, DialogueProgressEntry> = new Map();

  // Unified input queue (Gambetta reconciliation model)
  inputQueue: InputFrame[] = [];
  lastProcessedInput: number = 0;
  planBacklog: InputFrame[] = [];

  // Dialogue lock state
  talkingToNpcId: string | null = null;     // player → which NPC am I talking to
  currentTalkingTo: string | null = null;   // NPC → which player is talking to me

  // Speech bubble
  bubbleText: string | null = null;
  bubbleExpiresAt: number = 0;

  constructor(init: AgentInit) {
    this.id = init.id;
    this.name = init.name ?? init.id;
    this.position = { ...init.position };
    this.faction = init.faction;
    this.role = init.role;
    this.facing = init.facing ?? "south";
    this.hp = init.hp ?? DEFAULT_MAX_HP;
    this.maxHp = DEFAULT_MAX_HP;
    this.inventory = emptyResourceStore();
    this.state = "idle";
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

  setBubble(text: string, durationTicks: number, currentTick: number): void {
    if (!text || durationTicks <= 0) {
      this.bubbleText = null;
      this.bubbleExpiresAt = 0;
      return;
    }
    this.bubbleText = text.length > BUBBLE_MAX_LEN ? text.slice(0, BUBBLE_MAX_LEN) : text;
    this.bubbleExpiresAt = currentTick + durationTicks;
  }

  takeDamage(damage: number): void {
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp <= 0) {
      this.state = "dead";
      this.inputQueue = [];
      this.planBacklog = [];
    }
  }

  isAlive(): boolean {
    return this.hp > 0;
  }

  enqueueInput(frame: InputFrame): void {
    // Player frame (seq > 0): reject stale/duplicate, then flush bot frames
    if (frame.seq > 0) {
      if (frame.seq <= this.lastProcessedInput) return;
      const lastQueued = this.inputQueue.length > 0
        ? this.inputQueue[this.inputQueue.length - 1].seq
        : 0;
      if (lastQueued > 0 && frame.seq <= lastQueued) return;
      this.inputQueue = this.inputQueue.filter((f) => f.seq > 0);
      this.planBacklog = [];
    }
    this.inputQueue.push(frame);
    while (this.inputQueue.length > INPUT_QUEUE_CAP) {
      this.inputQueue.shift();
    }
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

  getAllBeliefs(): ReadonlyMap<string, Fact> {
    return this.beliefs;
  }

  mergeBeliefs(other: ReadonlyMap<string, Fact>): void {
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
