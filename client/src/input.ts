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

const ACTION_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyG", "KeyT"] as const;

const QWERTY_LABELS: Record<string, string> = {
  KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D",
  KeyQ: "Q", KeyE: "E", KeyG: "G", KeyT: "T",
};

export async function getKeyLabels(): Promise<Record<string, string>> {
  const labels = { ...QWERTY_LABELS };
  try {
    const keyboard = (navigator as any).keyboard;
    if (!keyboard?.getLayoutMap) return labels;
    const layoutMap: Map<string, string> = await keyboard.getLayoutMap();
    for (const code of ACTION_CODES) {
      const char = layoutMap.get(code);
      if (char) labels[code] = char.toUpperCase();
    }
  } catch {
    // API unavailable or permission denied — use QWERTY fallback
  }
  return labels;
}

export function formatKeyHints(labels: Record<string, string>): string {
  const move = `${labels.KeyW}${labels.KeyA}${labels.KeyS}${labels.KeyD}`;
  return `${move}:Move  ${labels.KeyE}:Interact  ${labels.KeyQ}:Attack  ${labels.KeyG}:Gather  ${labels.KeyT}:Deposit`;
}

const MOVE_THROTTLE_MS = 200;

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 }, ArrowUp: { dx: 0, dy: -1 },
  KeyA: { dx: -1, dy: 0 }, ArrowLeft: { dx: -1, dy: 0 },
  KeyS: { dx: 0, dy: 1 },  ArrowDown: { dx: 0, dy: 1 },
  KeyD: { dx: 1, dy: 0 },  ArrowRight: { dx: 1, dy: 0 },
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

    const code = e.code;

    // WASD / arrow movement (physical key position, layout-independent)
    const move = MOVE_KEYS[code];
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

    switch (code) {
      case "KeyQ": {
        // Attack nearest adjacent enemy
        const enemy = this.nearbyEntities.find(
          (e) => e.faction !== faction && e.hp > 0 && this.isAdjacent(x, y, e.x, e.y),
        );
        if (enemy) this.send({ type: "attack", targetId: enemy.id });
        break;
      }
      case "KeyG":
        this.send({ type: "gather", resourceTile: { x, y } });
        break;
      case "KeyT":
        if (this.currentSettlementId) {
          this.send({ type: "deposit", settlementId: this.currentSettlementId });
        }
        break;
      case "KeyE":
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
