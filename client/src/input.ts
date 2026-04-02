// client/src/input.ts
import type { ActionCommand } from "@town-zero/shared";
import type { ModalRequest } from "./types.js";

export type SendFn = (cmd: ActionCommand) => void;

interface AgentInfo {
  x: number;
  y: number;
  faction: string;
}

interface NearbyEntity {
  id: string;
  x: number;
  y: number;
  faction: string;
  role: string;
  controller: string;
  hp: number;
}

const MOVE_THROTTLE_MS = 200;

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  w: { dx: 0, dy: -1 }, arrowup: { dx: 0, dy: -1 },
  a: { dx: -1, dy: 0 }, arrowleft: { dx: -1, dy: 0 },
  s: { dx: 0, dy: 1 },  arrowdown: { dx: 0, dy: 1 },
  d: { dx: 1, dy: 0 },  arrowright: { dx: 1, dy: 0 },
};

export class InputHandler {
  private send: SendFn;
  private lastMoveTime = 0;
  private enabled = true;
  private onModal: ((req: ModalRequest) => void) | null = null;

  // Updated each tick by main loop
  private playerAgent: AgentInfo | null = null;
  private nearbyEntities: NearbyEntity[] = [];
  private currentSettlementId: string | null = null;

  constructor(send: SendFn) {
    this.send = send;
    this.handleKey = this.handleKey.bind(this);
    window.addEventListener("keydown", this.handleKey);
  }

  setPlayerInfo(agent: AgentInfo | null, nearby: NearbyEntity[], settlementId: string | null): void {
    this.playerAgent = agent;
    this.nearbyEntities = nearby;
    this.currentSettlementId = settlementId;
  }

  setModalHandler(handler: (req: ModalRequest) => void): void {
    this.onModal = handler;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.enabled || !this.playerAgent) return;
    if (e.repeat) return;

    const key = e.key.toLowerCase();

    // WASD / arrow movement
    const move = MOVE_KEYS[key];
    if (move) {
      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;
      this.send({
        type: "move",
        target: { x: this.playerAgent.x + move.dx, y: this.playerAgent.y + move.dy },
      });
      return;
    }

    const { x, y, faction } = this.playerAgent;

    switch (key) {
      case "q": {
        // Attack nearest adjacent enemy
        const enemy = this.nearbyEntities.find(
          (e) => e.faction !== faction && e.hp > 0 && this.isAdjacent(x, y, e.x, e.y),
        );
        if (enemy) this.send({ type: "attack", targetId: enemy.id });
        break;
      }
      case "g":
        this.send({ type: "gather", resourceTile: { x, y } });
        break;
      case "t":
        if (this.currentSettlementId) {
          this.send({ type: "deposit", settlementId: this.currentSettlementId });
        }
        break;
      case "e":
        this.handleInteract();
        break;
    }
  }

  private handleInteract(): void {
    if (!this.playerAgent) return;
    const { x, y, faction } = this.playerAgent;

    // 1. Adjacent merchant
    const merchant = this.nearbyEntities.find(
      (e) => e.role === "merchant" && this.isAdjacent(x, y, e.x, e.y),
    );
    if (merchant) {
      this.onModal?.({ type: "trade", merchantId: merchant.id });
      return;
    }

    // 2. Adjacent same-faction NPC
    const npc = this.nearbyEntities.find(
      (e) => e.faction === faction && e.controller !== "player" && e.hp > 0
        && this.isAdjacent(x, y, e.x, e.y),
    );
    if (npc) {
      this.send({ type: "talk", targetId: npc.id, optionId: "greet" });
      return;
    }

    // 3. Standing on settlement
    if (this.currentSettlementId) {
      this.send({ type: "take", settlementId: this.currentSettlementId, resource: "food", amount: 1 });
    }
  }

  private isAdjacent(x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKey);
  }
}
