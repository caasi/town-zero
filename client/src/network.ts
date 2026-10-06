// client/src/network.ts
import { Client, Room } from "@colyseus/sdk";
import type { InputFrame, DialogueStatePayload } from "@town-zero/shared";
import type { VisionData } from "./types.js";

export class NetworkClient {
  private client: Client | null = null;
  private room: Room | null = null;
  private _playerId: string | null = null;
  private visionCallbacks: Array<(data: VisionData) => void> = [];
  private deathCallbacks: Array<(data: { agentId: string; reviveInMs: number }) => void> = [];
  private revivedCallbacks: Array<() => void> = [];
  private dialogueStateCallbacks: Array<(data: DialogueStatePayload) => void> = [];
  private dialogueEndCallbacks: Array<(data: { reason: string }) => void> = [];
  private dialogueErrorCallbacks: Array<(data: { error: string }) => void> = [];
  private leftCallbacks: Array<(code: number) => void> = [];
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
    // Dev: Vite on :3000, game server on :2567. Production: nginx serves both
    // under one origin and routes matchmaking and WebSocket upgrades to the game.
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const endpoint = import.meta.env.DEV
      ? `${protocol}://${window.location.hostname}:2567`
      : window.location.origin;
    this.client = new Client(endpoint);
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

    // The server removes a player at once on leave (no allowReconnection), so
    // the SDK's retries (15 over ~56 s, measured) can never succeed and only
    // freeze the screen. Turn them off: onLeave then fires at the drop.
    this.room.reconnection.enabled = false;

    // The server closed the room or restarted (every deploy does). A leave we
    // start (disconnect, join timeout) clears this.room in the same call, and
    // onLeave only fires later on socket close, so the check skips it.
    const room = this.room;
    room.onLeave((code: number) => {
      if (this.room !== room) return;
      for (const cb of this.leftCallbacks) cb(code);
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

    this.room.onMessage("death", (data: { agentId: string; reviveInMs: number }) => {
      for (const cb of this.deathCallbacks) cb(data);
    });

    this.room.onMessage("revived", () => {
      for (const cb of this.revivedCallbacks) cb();
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

  sendInput(frame: InputFrame): void {
    this.room?.send("input", frame);
  }

  onVision(cb: (data: VisionData) => void): void {
    this.visionCallbacks.push(cb);
  }

  onDeath(cb: (data: { agentId: string; reviveInMs: number }) => void): void {
    this.deathCallbacks.push(cb);
  }

  onRevived(cb: () => void): void {
    this.revivedCallbacks.push(cb);
  }

  sendRevive(): void {
    this.room?.send("revive");
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
    this.revivedCallbacks = [];
    this.dialogueStateCallbacks = [];
    this.dialogueEndCallbacks = [];
    this.dialogueErrorCallbacks = [];
    this.leftCallbacks = [];
  }

  onLeft(cb: (code: number) => void): void {
    this.leftCallbacks.push(cb);
  }
}
