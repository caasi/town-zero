// client/src/network.ts
import { Client, Room } from "@colyseus/sdk";
import type { ActionCommand } from "@town-zero/shared";
import type { VisionData } from "./types.js";

export class NetworkClient {
  private client: Client | null = null;
  private room: Room | null = null;
  private _playerId: string | null = null;
  private visionCallbacks: Array<(data: VisionData) => void> = [];
  private deathCallbacks: Array<(agentId: string) => void> = [];
  private joinedResolve: ((agentId: string) => void) | null = null;
  private joinedReject: ((reason: Error) => void) | null = null;

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
      setTimeout(() => reject(new Error("Timed out waiting for joined message")), 10_000);
    });

    this.room.onMessage("joined", (data: { agentId: string }) => {
      this._playerId = data.agentId;
      if (this.joinedResolve) {
        this.joinedResolve(data.agentId);
        this.joinedResolve = null;
      }
    });

    this.room.onMessage("vision", (data: VisionData) => {
      for (const cb of this.visionCallbacks) cb(data);
    });

    this.room.onMessage("death", (data: { agentId: string }) => {
      for (const cb of this.deathCallbacks) cb(data.agentId);
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

  disconnect(): void {
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
  }
}
