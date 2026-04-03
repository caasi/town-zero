import { Room, Client } from "@colyseus/core";
import { TICK_RATE_MS } from "@town-zero/shared";
import { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import { syncToSchema, syncTiles } from "./sync.js";
import { isValidActionCommand } from "./validation.js";
import { extractVisionForPlayer } from "./vision.js";
import { Agent } from "../simulation/agent.js";

export class GameRoom extends Room<{ state: WorldStateSchema }> {
  private simState!: SimulationState;
  private sessionToAgent = new Map<string, string>();
  private nextPlayerId = 0;

  onCreate() {
    this.simState = generateMap();

    this.setState(new WorldStateSchema());
    this.state.width = this.simState.grid.width;
    this.state.height = this.simState.grid.height;
    syncTiles(this.simState.grid, this.state, this.simState.settlements);
    syncToSchema(this.simState, this.state);

    this.onMessage("command", (client: Client, cmd: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;

      if (!isValidActionCommand(cmd)) return;

      agent.setPlan([cmd]);
    });

    // Fixed-step simulation: deltaTime is intentionally ignored
    this.setSimulationInterval(() => this.tick(), TICK_RATE_MS);

    console.log("GameRoom created");
  }

  onJoin(client: Client, options?: { name?: string }) {
    const village = Array.from(this.simState.settlements.values())
      .find((s) => s.type === "village");

    if (!village) {
      client.leave(4000, "No village available");
      return;
    }

    if (village.populationIds.length >= village.getPopulationCap()) {
      client.leave(4001, "Village is full");
      return;
    }

    const raw = typeof options?.name === "string" ? options.name.trim().slice(0, 32) : "";
    const name = raw.length > 0 ? raw : `Player-${this.nextPlayerId}`;
    const id = `player-${this.nextPlayerId++}`;

    // Find unoccupied tile in village territory
    const occupiedPositions = new Set(
      Array.from(this.simState.agents.values())
        .map((a) => `${a.position.x},${a.position.y}`),
    );
    const spawnTile = village.territory.find(
      (t) => !occupiedPositions.has(`${t.x},${t.y}`),
    ) ?? village.territory[0];

    const agent = new Agent({
      id,
      position: { ...spawnTile },
      faction: village.faction,
      role: "player",
      controller: "player",
    });
    agent.addToInventory("food", 5);

    this.simState.agents.set(id, agent);
    village.populationIds.push(id);
    this.sessionToAgent.set(client.sessionId, id);
    client.send("joined", { agentId: id });

    console.log(`${name} joined as ${id} (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const agentId = this.sessionToAgent.get(client.sessionId);
    if (!agentId) return;

    const agent = this.simState.agents.get(agentId);
    if (agent) {
      agent.controller = "bot";
    }

    this.sessionToAgent.delete(client.sessionId);
    console.log(`${agentId} left, now bot-controlled (${client.sessionId})`);
  }

  private tick() {
    processTick(this.simState);
    syncToSchema(this.simState, this.state);
    this.sendVisionUpdates();
    this.checkPlayerDeaths();
  }

  private sendVisionUpdates() {
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) continue;

      const client = this.clients.getById(sessionId);
      if (!client) continue;

      const vision = extractVisionForPlayer(agent, this.simState.tick);
      client.send("vision", vision);
    }
  }

  private checkPlayerDeaths() {
    const deadSessions: string[] = [];
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || agent.isAlive()) continue;

      const client = this.clients.getById(sessionId);
      if (client) {
        client.send("death", { agentId });
      }
      deadSessions.push(sessionId);
    }
    for (const sessionId of deadSessions) {
      this.sessionToAgent.delete(sessionId);
    }
  }
}
