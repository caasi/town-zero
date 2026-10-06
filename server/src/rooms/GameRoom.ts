import { Room, Client } from "@colyseus/core";
import { TICK_RATE_MS, REVIVE_DELAY_TICKS } from "@town-zero/shared";
import { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import { syncToSchema, syncTiles, syncAgent } from "./sync.js";
import { isValidInputFrame } from "./validation.js";
import { extractVisionForPlayer } from "./vision.js";
import { Agent } from "../simulation/agent.js";
import type { Settlement } from "../simulation/settlement.js";
import type { Position } from "@town-zero/shared";
import { advanceDialogue, chooseDialogue, endDialogue, tickDialogues } from "../dialogue/session-manager.js";
import { purgeProximityState } from "./proximity-state-cleanup.js";
import { JevController } from "../ai/jev-controller.js";
import { jevChooser } from "../ai/jev.js";

export class GameRoom extends Room<{ state: WorldStateSchema }> {
  private simState!: SimulationState;
  private sessionToAgent = new Map<string, string>();
  private nextPlayerId = 0;
  private jev!: JevController;
  // Dead player agents → tick from which "revive" is accepted.
  private reviveAt = new Map<string, number>();

  onCreate() {
    this.simState = generateMap();
    const jevKey = process.env.TYPESAFE_API_KEY;
    this.jev = new JevController(jevKey ? jevChooser(jevKey) : null);
    console.log(jevKey ? "AI NPCs: Jev" : "AI NPCs: fallback rules (TYPESAFE_API_KEY not set)");

    this.setState(new WorldStateSchema());
    this.state.width = this.simState.grid.width;
    this.state.height = this.simState.grid.height;
    syncTiles(this.simState.grid, this.state, this.simState.settlements);
    syncToSchema(this.simState, this.state);

    this.onMessage("input", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent || !agent.isAlive()) return;
      if (!isValidInputFrame(data)) return;
      if (data.seq < 1) return;
      agent.enqueueInput(data);
    });

    this.onMessage("revive", (client: Client) => this.revive(client));

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

      endDialogue(agent.talkingToNpcId, this.simState, "player_left");
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

    const spawnTile = this.findSpawnTile(village);

    const agent = new Agent({
      id,
      position: { ...spawnTile },
      faction: village.faction,
      role: "player",
      controller: "player",
    });
    agent.addToInventory("food", 5);
    agent.lastProcessedInput = 0;
    agent.inputQueue = [];
    agent.planBacklog = [];

    this.simState.agents.set(id, agent);
    village.populationIds.push(id);
    this.sessionToAgent.set(client.sessionId, id);
    client.send("joined", { agentId: id });

    console.log(`${name} joined as ${id} (${client.sessionId})`);
  }

  private findSpawnTile(village: Settlement): Position {
    const occupied = new Set(
      Array.from(this.simState.agents.values())
        .filter((a) => a.isAlive())
        .map((a) => `${a.position.x},${a.position.y}`),
    );
    return village.territory.find((t) => !occupied.has(`${t.x},${t.y}`)) ?? village.territory[0];
  }

  private revive(client: Client): void {
    const agentId = this.sessionToAgent.get(client.sessionId);
    if (!agentId) return;
    const agent = this.simState.agents.get(agentId);
    const readyTick = this.reviveAt.get(agentId);
    if (!agent || agent.isAlive() || readyTick === undefined || this.simState.tick < readyTick) return;

    // The dead player kept its population slot (processTick), so no cap check here.
    const village = Array.from(this.simState.settlements.values()).find((s) => s.populationIds.includes(agentId));
    if (!village) return;

    agent.revive(this.findSpawnTile(village));
    this.reviveAt.delete(agentId);
    client.send("revived", { agentId });
  }

  onLeave(client: Client) {
    const agentId = this.sessionToAgent.get(client.sessionId);
    if (!agentId) return;

    const agent = this.simState.agents.get(agentId);
    if (agent?.talkingToNpcId) {
      endDialogue(agent.talkingToNpcId, this.simState, "player_left");
    }
    // A new join always creates a new agent, so a left agent would only hold a population slot.
    this.simState.agents.delete(agentId);
    this.reviveAt.delete(agentId);
    for (const settlement of this.simState.settlements.values()) {
      settlement.populationIds = settlement.populationIds.filter((id) => id !== agentId);
    }

    this.sessionToAgent.delete(client.sessionId);
    purgeProximityState(this.simState, agentId);
    console.log(`${agentId} left and was removed (${client.sessionId})`);
  }

  private tick() {
    // Jev calls cost money: with no player in the world, no AI NPC gets a new
    // frame or decision. processTick still runs (hunger, vision) for everyone.
    if (this.sessionToAgent.size > 0) this.jev.update(this.simState);
    const talkResults = processTick(this.simState);

    // Send dialogue messages for talk actions executed this tick
    for (const { agentId, targetId, result } of talkResults) {
      if (result.ok) {
        const playerAgent = this.simState.agents.get(agentId);
        const npcAgent = this.simState.agents.get(targetId);
        const playerSchema = this.state.agents.get(agentId);
        const npcSchema = this.state.agents.get(targetId);
        if (playerAgent && playerSchema) syncAgent(playerAgent, playerSchema);
        if (npcAgent && npcSchema) syncAgent(npcAgent, npcSchema);

        if (result.ended) {
          this.sendToAgent(agentId, "dialogue:end", { reason: "completed" });
        } else {
          this.sendToAgent(agentId, "dialogue:state", result.payload);
        }
      } else {
        this.sendToAgent(agentId, "dialogue:error", { error: result.error });
      }
    }

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

  // The session stays bound to its dead agent so the player can revive it.
  private checkPlayerDeaths() {
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || agent.isAlive() || this.reviveAt.has(agentId)) continue;

      // Death ends any dialogue, or its lock would outlive the revive and block all input.
      if (agent.talkingToNpcId) endDialogue(agent.talkingToNpcId, this.simState, "player_left");
      this.reviveAt.set(agentId, this.simState.tick + REVIVE_DELAY_TICKS);
      this.clients.getById(sessionId)?.send("death", {
        agentId,
        reviveInMs: REVIVE_DELAY_TICKS * TICK_RATE_MS,
      });
    }
  }
}
