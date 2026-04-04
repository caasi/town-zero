import { Room, Client } from "@colyseus/core";
import { TICK_RATE_MS } from "@town-zero/shared";
import type { Facing } from "@town-zero/shared";
import { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import { syncToSchema, syncTiles, syncAgent } from "./sync.js";
import { isValidActionCommand } from "./validation.js";
import { extractVisionForPlayer } from "./vision.js";
import { Agent } from "../simulation/agent.js";
import { startDialogue, advanceDialogue, chooseDialogue, endDialogue, tickDialogues } from "../dialogue/session-manager.js";

const VALID_DIRECTIONS = new Set<string>(["north", "south", "east", "west"]);

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

      // Handle talk command immediately (not through tick pipeline)
      if (cmd.type === "talk") {
        const result = startDialogue(agentId, cmd.targetId, this.simState);
        if (result.ok) {
          // Sync both agents immediately so facing changes reach clients
          // before the next tick (startDialogue sets facing on both).
          const playerAgent = this.simState.agents.get(agentId);
          const npcAgent = this.simState.agents.get(cmd.targetId);
          const playerSchema = this.state.agents.get(agentId);
          const npcSchema = this.state.agents.get(cmd.targetId);
          if (playerAgent && playerSchema) syncAgent(playerAgent, playerSchema);
          if (npcAgent && npcSchema) syncAgent(npcAgent, npcSchema);

          if (result.ended) {
            client.send("dialogue:end", { reason: "completed" });
          } else {
            client.send("dialogue:state", result.payload);
          }
        } else {
          client.send("dialogue:error", { error: result.error });
        }
        return;
      }

      if (agent.state === "talking") return;
      agent.setPlan([cmd]);
    });

    // Key-state movement: client sends direction on keydown/keyup
    this.onMessage("move:start", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;
      if (agent.state === "talking") return;
      if (typeof data !== "object" || data === null) return;
      const dir = (data as any).direction;
      if (!VALID_DIRECTIONS.has(dir)) return;
      agent.heldDirection = dir as Facing;
    });

    this.onMessage("move:stop", (client: Client) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent) return;
      agent.heldDirection = null;
    });

    this.onMessage("dialogue:advance", (client: Client) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      const result = advanceDialogue(agentId, this.simState);
      if (result.ok) {
        if (result.ended) {
          client.send("dialogue:end", { reason: "completed" });
        } else {
          client.send("dialogue:state", result.payload);
        }
      } else {
        client.send("dialogue:error", { error: result.error });
      }
    });

    this.onMessage("dialogue:choose", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      if (!data || typeof data !== "object" || !("optionId" in data) || typeof (data as any).optionId !== "string") return;

      const result = chooseDialogue(agentId, (data as any).optionId, this.simState);
      if (result.ok) {
        if (result.ended) {
          client.send("dialogue:end", { reason: "completed" });
        } else {
          client.send("dialogue:state", result.payload);
        }
      } else {
        client.send("dialogue:error", { error: result.error });
      }
    });

    this.onMessage("dialogue:close", (client: Client) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      const agent = this.simState.agents.get(agentId);
      if (!agent?.talkingToNpcId) return;

      endDialogue(agent.talkingToNpcId, this.simState);
      client.send("dialogue:end", { reason: "closed" });
    });

    // Fixed-step simulation at 8 ticks/s: deltaTime is intentionally ignored
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
      if (agent.talkingToNpcId) {
        endDialogue(agent.talkingToNpcId, this.simState);
      }
      agent.controller = "bot";
    }

    this.sessionToAgent.delete(client.sessionId);
    console.log(`${agentId} left, now bot-controlled (${client.sessionId})`);
  }

  private tick() {
    processTick(this.simState);

    const expired = tickDialogues(this.simState);
    for (const { playerId, reason } of expired) {
      this.sendToAgent(playerId, "dialogue:end", { reason });
    }

    syncToSchema(this.simState, this.state);
    this.sendVisionUpdates();
    this.checkPlayerDeaths();
  }

  private sendToAgent(agentId: string, type: string, data: unknown) {
    for (const [sessionId, aid] of this.sessionToAgent) {
      if (aid === agentId) {
        const client = this.clients.getById(sessionId);
        if (client) client.send(type, data);
        return;
      }
    }
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
