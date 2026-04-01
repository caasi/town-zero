export interface TileState {
  x: number;
  y: number;
  terrain: string;
  owner: string;
  resourceYield: string;
}

export interface AgentState {
  id: string;
  x: number;
  y: number;
  faction: string;
  role: string;
  hp: number;
  maxHp: number;
  food: number;
  material: number;
  currency: number;
  state: string;
  controller: string;
}

export interface SettlementState {
  id: string;
  faction: string;
  settlementType: string;
  food: number;
  material: number;
  currency: number;
}

export interface WorldState {
  tick: number;
  tiles: TileState[];
  agents: { forEach: (fn: (v: AgentState, k: string) => void) => void; get: (k: string) => AgentState | undefined };
  settlements: { forEach: (fn: (v: SettlementState, k: string) => void) => void };
}
