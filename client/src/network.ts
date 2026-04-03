// client/src/network.ts
import { Client, Room } from "@colyseus/sdk";
import type { ActionCommand, DialogueStatePayload } from "@town-zero/shared";
import type { VisionData } from "./types.js";

export class NetworkClient {
  private client: Client | null = null;
  private room: Room | null = null;
  private _playerId: string | null = null;
  private visionCallbacks: Array<(data: VisionData) => void> = [];
  private deathCallbacks: Array<(agentId: string) => void> = [];
  private dialogueStateCallbacks: Array<(data: DialogueStatePayload) => void> = [];
  private dialogueEndCallbacks: Array<(data: { reason: string }) => void> = [];
  private dialogueErrorCallbacks: Array<(data: { error: string }) => void> = [];
  private joinedResolve: ((agentId: string) => void) | null = null;
  private joinedReject: ((reason: Error) => void) | null = null;
  private joinedTimeout: ReturnType<typeof setTimeout> | null = null;

  get state(): any {
    return this.room?.state ?? null;
  }

  get playerId(): string | null {
    return this._playerId;
  }

  async connect(name: string): Promise<void> {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    this.client = new Client(`${protocol}://${window.location.hostname}:2567`);
    this.room = await this.client.joinOrCreate("game", { name });

    const joinedPromise = new Promise<string>((resolve, reject) => {
      this.joinedResolve = resolve;
      this.joinedReject = reject;
      this.joinedTimeout = setTimeout(() => {
        this.joinedTimeout = null;
        this.joinedResolve = null;
        this.joinedReject = null;
        this.room?.leave();
        this.room = null;
        this.client = null;
        reject(new Error("Timed out waiting for joined message"));
      }, 10_000);
    });

    this.room.onMessage("joined", (data: { agentId: string }) => {
      if (!this.joinedResolve) return;
      this._playerId = data.agentId;
      if (this.joinedTimeout) {
        clearTimeout(this.joinedTimeout);
        this.joinedTimeout = null;
      }
      this.joinedResolve(data.agentId);
      this.joinedResolve = null;
      this.joinedReject = null;
    });

    this.room.onMessage("vision", (data: VisionData) => {
      for (const cb of this.visionCallbacks) cb(data);
    });

    this.room.onMessage("death", (data: { agentId: string }) => {
      for (const cb of this.deathCallbacks) cb(data.agentId);
    });

    this.room.onMessage("dialogue:state", (data: DialogueStatePayload) => {
      for (const cb of this.dialogueStateCallbacks) cb(data);
    });

    this.room.onMessage("dialogue:end", (data: { reason: string }) => {
      for (const cb of this.dialogueEndCallbacks) cb(data);
    });

    this.room.onMessage("dialogue:error", (data: { error: string }) => {
      for (const cb of this.dialogueErrorCallbacks) cb(data);
    });

    await joinedPromise;
  }

  send(cmd: ActionCommand): void {
    this.room?.send("command", cmd);
  }

  onVision(cb: (data: VisionData) => void): void {
    this.visionCallbacks.push(cb);
  }

  onDeath(cb: (agentId: string) => void): void {
    this.deathCallbacks.push(cb);
  }

  onDialogueState(cb: (data: DialogueStatePayload) => void): void {
    this.dialogueStateCallbacks.push(cb);
  }

  onDialogueEnd(cb: (data: { reason: string }) => void): void {
    this.dialogueEndCallbacks.push(cb);
  }

  onDialogueError(cb: (data: { error: string }) => void): void {
    this.dialogueErrorCallbacks.push(cb);
  }

  sendDialogueAdvance(): void {
    this.room?.send("dialogue:advance");
  }

  sendDialogueChoose(optionId: string): void {
    this.room?.send("dialogue:choose", { optionId });
  }

  sendDialogueClose(): void {
    this.room?.send("dialogue:close");
  }

  disconnect(): void {
    if (this.joinedTimeout) {
      clearTimeout(this.joinedTimeout);
      this.joinedTimeout = null;
    }
    if (this.joinedReject) {
      this.joinedReject(new Error("Disconnected"));
      this.joinedResolve = null;
      this.joinedReject = null;
    }
    this.room?.leave();
    this.room = null;
    this.client = null;
    this._playerId = null;
    this.visionCallbacks = [];
    this.deathCallbacks = [];
    this.dialogueStateCallbacks = [];
    this.dialogueEndCallbacks = [];
    this.dialogueErrorCallbacks = [];
  }
}
