// client/src/input.ts
import type { ActionCommand } from "@town-zero/shared";
import type { ModalRequest } from "./types.js";
import type { DisplayState } from "./display.js";

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

export function formatDialogueKeyHints(labels: Record<string, string>): string {
  return `${labels.KeyW}/${labels.KeyS}:Select  ${labels.KeyE}:Confirm  Esc:Close`;
}

const MOVE_THROTTLE_MS = 120;

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

  // Movement prediction
  private displayState: DisplayState | null = null;
  private tiles: { get(key: string): { terrain: string } | undefined } | null = null;
  private playerState: string = "idle";

  // Held-key tracking for continuous movement
  private heldKeys = new Set<string>();

  // Dialogue mode
  private _dialogueMode = false;
  onDialogueAdvance: (() => void) | null = null;
  onDialogueChoose: ((optionId: string) => void) | null = null;
  onDialogueClose: (() => void) | null = null;
  onDialogueMoveSelection: ((delta: -1 | 1) => void) | null = null;
  onDialogueGetSelectedId: (() => string | null) | null = null;
  onDialogueIsText: (() => boolean) | null = null;

  private handleBlur = (): void => {
    this.heldKeys.clear();
  };

  constructor(send: SendFn) {
    this.send = send;
    this.handleKey = this.handleKey.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    window.addEventListener("keydown", this.handleKey);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    document.addEventListener("visibilitychange", this.handleBlur);
  }

  setPredictionContext(
    displayState: DisplayState,
    tiles: { get(key: string): { terrain: string } | undefined },
  ): void {
    this.displayState = displayState;
    this.tiles = tiles;
  }

  setPlayerInfo(
    agent: AgentInfo | null,
    nearby: NearbyEntity[],
    settlementId: string | null,
    agentState?: string,
  ): void {
    this.playerAgent = agent;
    this.nearbyEntities = nearby;
    this.currentSettlementId = settlementId;
    this.playerState = agentState ?? "idle";
  }

  setModalHandler(handler: (req: ModalRequest) => void): void {
    this.onModal = handler;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  get dialogueMode(): boolean {
    return this._dialogueMode;
  }

  enterDialogueMode(): void {
    this._dialogueMode = true;
    this.heldKeys.clear();
  }

  exitDialogueMode(): void {
    this._dialogueMode = false;
  }

  /**
   * Called every frame from the game loop. Processes held movement keys.
   */
  update(): void {
    if (!this.enabled || !this.playerAgent || this._dialogueMode) return;

    // Find the first held movement key
    for (const code of this.heldKeys) {
      const move = MOVE_KEYS[code];
      if (!move) continue;

      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;

      const origin = this.displayState?.getLocalPlayerPosition()
        ?? { x: this.playerAgent.x, y: this.playerAgent.y };
      const targetX = origin.x + move.dx;
      const targetY = origin.y + move.dy;

      if (this.displayState && this.tiles) {
        const predicted = this.displayState.predictMove(
          targetX, targetY, this.playerState, this.tiles,
        );
        if (!predicted) return;
      }

      this.send({
        type: "move",
        target: { x: targetX, y: targetY },
      });
      return;
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // Dialogue mode input
    if (this._dialogueMode) {
      e.preventDefault();
      if (e.repeat) return;

      switch (e.code) {
        case "KeyW": case "ArrowUp":
          this.onDialogueMoveSelection?.(-1);
          break;
        case "KeyS": case "ArrowDown":
          this.onDialogueMoveSelection?.(1);
          break;
        case "KeyE": case "Enter": {
          const isText = this.onDialogueIsText?.() ?? false;
          if (isText) {
            this.onDialogueAdvance?.();
          } else {
            const optionId = this.onDialogueGetSelectedId?.();
            if (optionId) this.onDialogueChoose?.(optionId);
          }
          break;
        }
        case "Escape":
          this.onDialogueClose?.();
          break;
      }
      return;
    }

    if (!this.playerAgent) return;

    const code = e.code;

    // Track movement key presses — actual movement happens in update().
    // preventDefault stops Arrow keys from scrolling the page.
    if (code in MOVE_KEYS) {
      e.preventDefault();
      this.heldKeys.add(code);
      return;
    }

    // Block repeat for action keys
    if (e.repeat) return;

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
      this.send({ type: "talk", targetId: npc.id });
      return;
    }

    // 3. Standing on settlement
    if (this.currentSettlementId) {
      this.send({ type: "take", settlementId: this.currentSettlementId, resource: "food", amount: 1 });
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  private isAdjacent(x1: number, y1: number, x2: number, y2: number): boolean {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2) === 1;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKey);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    document.removeEventListener("visibilitychange", this.handleBlur);
    this.heldKeys.clear();
  }
}
