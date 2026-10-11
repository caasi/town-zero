import { Room, Client } from "@colyseus/core";
import { TICK_RATE_MS, REVIVE_DELAY_TICKS, IDLE_TIMEOUT_TICKS, JOIN_REFUSED_FULL, JOIN_REFUSED_NO_VILLAGE, normalizePlayerName, playerNameKey, uniquePlayerName } from "@town-zero/shared";
import { WorldStateSchema } from "./schemas/WorldStateSchema.js";
import { generateMap } from "../map/generator.js";
import { processTick, type SimulationState } from "../simulation/tick.js";
import { syncToSchema, syncTiles, syncAgent } from "./sync.js";
import { isValidInputFrame } from "./validation.js";
import { extractVisionForPlayer } from "./vision.js";
import { Agent } from "../simulation/agent.js";
import { advanceDialogue, buildPayload, chooseDialogue, endDialogue, tickDialogues } from "../dialogue/session-manager.js";
import { purgeProximityState } from "./proximity-state-cleanup.js";
import { findSpawnTile, processRespawns } from "../simulation/respawn.js";
import { JevController } from "../ai/jev-controller.js";
import { ReplyController } from "../ai/reply-controller.js";
import { jevChooser } from "../ai/jev.js";

export class GameRoom extends Room<{ state: WorldStateSchema }> {
  private simState!: SimulationState;
  private sessionToAgent = new Map<string, string>();
  private nextPlayerId = 0;
  private jev!: JevController;
  private replies!: ReplyController;
  private reviveAt = new Map<string, number>();
  private respawnAt = new Map<string, number>();
  private lastMessageTick = new Map<string, number>();
  private hiddenSessions = new Set<string>();
  private jevPaused = false;

  onCreate() {
    this.simState = generateMap();
    const jevKey = process.env.TYPESAFE_API_KEY;
    const chooser = jevKey ? jevChooser(jevKey) : null;
    this.jev = new JevController(chooser);
    this.replies = new ReplyController(chooser);
    console.log(jevKey ? "AI NPCs: Jev" : "AI NPCs: fallback rules (TYPESAFE_API_KEY not set)");

    this.state = new WorldStateSchema();
    this.state.width = this.simState.grid.width;
    this.state.height = this.simState.grid.height;
    syncTiles(this.simState.grid, this.state, this.simState.settlements);
    syncToSchema(this.simState, this.state);

    this.onPlayerMessage("input", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      const agent = this.simState.agents.get(agentId);
      if (!agent) return;
      if (!isValidInputFrame(data)) return;
      if (data.seq < 1) return;
      if (!agent.isAlive()) {
        agent.lastProcessedInput = Math.max(agent.lastProcessedInput, data.seq);
        return;
      }
      agent.enqueueInput(data);
    });

    // Clients no longer send this (it dropped predicted moves). Kept as a no-op:
    // Colyseus disconnects a client that sends an unregistered type, and tabs
    // opened before a deploy still send it on key release. Remove when stale.
    this.onMessage("input:stop", () => {});

    this.onPlayerMessage("revive", (client: Client) => this.revive(client));

    this.onPlayerMessage("rename", (client: Client, data: unknown) => {
      const agent = this.simState.agents.get(this.sessionToAgent.get(client.sessionId) ?? "");
      if (!agent || !data || typeof data !== "object") return;
      const name = normalizePlayerName((data as { name?: unknown }).name);
      if (!name || name === agent.name) return;
      if (this.nameTaken(name, agent.id)) {
        client.send("rename:rejected", { name });
        return;
      }
      console.log(`[name] ${agent.id} renamed ${agent.name} -> ${name}`);
      agent.name = name;
    });

    this.onPlayerMessage("dialogue:advance", (client: Client) => {
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

    this.onPlayerMessage("dialogue:choose", (client: Client, data: unknown) => {
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

    this.onPlayerMessage("dialogue:close", (client: Client) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;

      const agent = this.simState.agents.get(agentId);
      if (!agent?.talkingToNpcId) return;

      endDialogue(agent.talkingToNpcId, this.simState, "player_left");
      client.send("dialogue:end", { reason: "closed" });
    });

    this.onMessage("presence", (client: Client, data: unknown) => {
      const agentId = this.sessionToAgent.get(client.sessionId);
      if (!agentId) return;
      if (!data || typeof data !== "object" || typeof (data as any).active !== "boolean") return;
      const active: boolean = (data as any).active;
      if (active) this.lastMessageTick.set(client.sessionId, this.simState.tick);
      if (active !== this.hiddenSessions.has(client.sessionId)) return;
      if (active) this.hiddenSessions.delete(client.sessionId);
      else this.hiddenSessions.add(client.sessionId);
      console.log(`[presence] ${agentId} ${active ? "visible" : "hidden"}`);
    });

    this.setSimulationInterval(() => this.tick(), TICK_RATE_MS);

    console.log("GameRoom created");
  }

  onJoin(client: Client, options?: { name?: string }) {
    const village = Array.from(this.simState.settlements.values())
      .find((s) => s.type === "village");

    if (!village) {
      client.leave(JOIN_REFUSED_NO_VILLAGE, "No village available");
      return;
    }

    if (village.populationIds.length >= village.getPopulationCap()) {
      client.leave(JOIN_REFUSED_FULL, "Village is full");
      return;
    }

    const name = uniquePlayerName(normalizePlayerName(options?.name) ?? `Player-${this.nextPlayerId}`, (n) => this.nameTaken(n));
    const id = `player-${this.nextPlayerId++}`;

    const spawnTile = findSpawnTile(village, this.simState);

    const agent = new Agent({
      id,
      position: { ...spawnTile },
      faction: village.faction,
      name,
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
    this.lastMessageTick.set(client.sessionId, this.simState.tick);
    client.send("joined", { agentId: id, commit: process.env.TOWN_ZERO_COMMIT || "dev" });

    console.log(`${name} joined as ${id} (${client.sessionId})`);
  }

  private revive(client: Client): void {
    const agentId = this.sessionToAgent.get(client.sessionId);
    if (!agentId) return;
    const agent = this.simState.agents.get(agentId);
    const readyTick = this.reviveAt.get(agentId);
    if (!agent || agent.isAlive() || readyTick === undefined || this.simState.tick < readyTick) return;

    const village = Array.from(this.simState.settlements.values()).find((s) => s.populationIds.includes(agentId));
    if (!village) return;

    agent.revive(findSpawnTile(village, this.simState));
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
    this.simState.agents.delete(agentId);
    this.reviveAt.delete(agentId);
    for (const settlement of this.simState.settlements.values()) {
      settlement.populationIds = settlement.populationIds.filter((id) => id !== agentId);
    }

    this.sessionToAgent.delete(client.sessionId);
    this.lastMessageTick.delete(client.sessionId);
    this.hiddenSessions.delete(client.sessionId);
    purgeProximityState(this.simState, agentId);
    console.log(`${agentId} left and was removed (${client.sessionId})`);
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    const key = playerNameKey(name);
    for (const agent of this.simState.agents.values()) {
      if (agent.id !== exceptId && playerNameKey(agent.name) === key) return true;
    }
    return false;
  }

  private onPlayerMessage(type: string, handler: (client: Client, data: unknown) => void) {
    this.onMessage(type, (client: Client, data: unknown) => {
      this.lastMessageTick.set(client.sessionId, this.simState.tick);
      handler(client, data);
    });
  }

  private hasActivePlayer(): boolean {
    for (const sessionId of this.sessionToAgent.keys()) {
      if (this.hiddenSessions.has(sessionId)) continue;
      const last = this.lastMessageTick.get(sessionId) ?? -Infinity;
      if (this.simState.tick - last < IDLE_TIMEOUT_TICKS) return true;
    }
    return false;
  }

  private logPauseChange(paused: boolean): void {
    this.jevPaused = paused;
    if (!paused) {
      console.log("[idle] Jev resumed");
      return;
    }
    const players = this.sessionToAgent.size;
    const hidden = [...this.sessionToAgent.keys()].filter((id) => this.hiddenSessions.has(id)).length;
    console.log(`[idle] Jev paused (hidden ${hidden}, idle ${players - hidden}, players ${players})`);
  }

  private tick() {
    const llmPaused = !this.hasActivePlayer();
    if (llmPaused !== this.jevPaused) this.logPauseChange(llmPaused);
    if (!llmPaused) this.jev.update(this.simState);
    const talkResults = processTick(this.simState, { llmPaused });
    processRespawns(this.simState, this.respawnAt);

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

    for (const session of this.replies.update(this.simState)) {
      this.sendToAgent(session.playerId, "dialogue:state", buildPayload(session, this.simState));
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
    for (const [sessionId, agentId] of this.sessionToAgent) {
      const agent = this.simState.agents.get(agentId);
      if (!agent || agent.isAlive() || this.reviveAt.has(agentId)) continue;

      if (agent.talkingToNpcId) endDialogue(agent.talkingToNpcId, this.simState, "player_left");
      this.reviveAt.set(agentId, this.simState.tick + REVIVE_DELAY_TICKS);
      this.clients.getById(sessionId)?.send("death", {
        agentId,
        reviveInMs: REVIVE_DELAY_TICKS * TICK_RATE_MS,
      });
    }
  }
}
