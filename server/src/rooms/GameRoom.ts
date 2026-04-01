import { Room, Client } from "colyseus";
import { WorldState } from "../schema/WorldState.js";
import { TileSchema } from "../schema/TileSchema.js";
import { AgentSchema } from "../schema/AgentSchema.js";
import { SettlementSchema } from "../schema/SettlementSchema.js";
import { StructureSchema } from "../schema/StructureSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import type { ActionCommand } from "@town-zero/shared";
import { TICK_RATE_MS, GRID_WIDTH, GRID_HEIGHT } from "@town-zero/shared";
import { Agent } from "../simulation/agent.js";

export class GameRoom extends Room<WorldState> {
  private sim!: SimulationState;
  private playerAgentMap = new Map<string, string>();
  private nextPlayerId = 0;
  autoDispose = false;
  maxClients = 4;

  onCreate(): void {
    this.setState(new WorldState());
    this.sim = generateMap();

    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const tile = new TileSchema();
        tile.x = x;
        tile.y = y;
        tile.terrain = this.sim.grid.getTerrain(x, y) ?? "plains";
        tile.owner = this.sim.grid.getOwner(x, y) ?? "";
        tile.resourceYield = this.sim.grid.getResourceYield(x, y) ?? "";
        this.state.tiles.push(tile);
      }
    }

    this.syncAgentsToSchema();
    this.syncSettlementsToSchema();

    this.onMessage("command", (client: Client, cmd: ActionCommand) => {
      const agentId = this.playerAgentMap.get(client.sessionId);
      if (!agentId) return;
      const agent = this.sim.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;
      agent.setPlan([cmd]);
    });

    this.setSimulationInterval(() => this.tick(), TICK_RATE_MS);
  }

  onJoin(client: Client): void {
    const village = Array.from(this.sim.settlements.values()).find((s) => s.type === "village");
    if (!village) return;

    const id = `player-${this.nextPlayerId++}`;
    const spawnPos = village.territory[0];
    const agent = new Agent({
      id,
      position: { ...spawnPos },
      faction: village.faction,
      role: "adventurer",
      controller: "player",
    });
    agent.addToInventory("food", 5);

    this.sim.agents.set(id, agent);
    this.playerAgentMap.set(client.sessionId, id);
    village.populationIds.push(id);

    client.send("assignAgent", { agentId: id });

    this.syncAgentsToSchema();
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const agentId = this.playerAgentMap.get(client.sessionId);
    if (!agentId) return;

    try {
      if (!consented) {
        await this.allowReconnection(client, 60);
        const agent = this.sim.agents.get(agentId);
        if (agent) agent.controller = "player";
        return;
      }
    } catch {
      // Reconnection timed out
    }

    const agent = this.sim.agents.get(agentId);
    if (agent) agent.controller = "bot";
    this.playerAgentMap.delete(client.sessionId);
  }

  private tick(): void {
    processTick(this.sim);
    this.state.tick = this.sim.tick;
    this.syncAgentsToSchema();
    this.syncSettlementsToSchema();
  }

  private syncAgentsToSchema(): void {
    for (const [id, agent] of this.sim.agents) {
      let schema = this.state.agents.get(id);
      if (!schema) {
        schema = new AgentSchema();
        schema.id = id;
        this.state.agents.set(id, schema);
      }
      schema.x = agent.position.x;
      schema.y = agent.position.y;
      schema.faction = agent.faction;
      schema.role = agent.role;
      schema.hp = agent.hp;
      schema.maxHp = agent.maxHp;
      schema.food = agent.inventory.food;
      schema.material = agent.inventory.material;
      schema.currency = agent.inventory.currency;
      schema.state = agent.state;
      schema.controller = agent.controller;
    }

    this.state.agents.forEach((_, key) => {
      if (!this.sim.agents.has(key)) {
        this.state.agents.delete(key);
      }
    });
  }

  private syncSettlementsToSchema(): void {
    for (const [id, settlement] of this.sim.settlements) {
      let schema = this.state.settlements.get(id);
      if (!schema) {
        schema = new SettlementSchema();
        schema.id = id;
        schema.faction = settlement.faction;
        schema.settlementType = settlement.type;

        for (const struct of settlement.structures) {
          const ss = new StructureSchema();
          ss.id = struct.id;
          ss.structureType = struct.type;
          ss.x = struct.position.x;
          ss.y = struct.position.y;
          ss.operatorId = struct.operatorId ?? "";
          schema.structures.push(ss);
        }
        this.state.settlements.set(id, schema);
      }
      schema.food = settlement.inventory.food;
      schema.material = settlement.inventory.material;
      schema.currency = settlement.inventory.currency;
    }
  }
}
