// client/src/input.ts
import type { ActionCommand, PendingInput } from "@town-zero/shared";
import { PENDING_INPUT_CAP } from "@town-zero/shared";
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

const ACTION_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyT"] as const;

const QWERTY_LABELS: Record<string, string> = {
  KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D",
  KeyQ: "Q", KeyE: "E", KeyT: "T",
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
  return `${move}:Move  ${labels.KeyE}:Interact  ${labels.KeyQ}:Attack  ${labels.KeyT}:Deposit`;
}

export function formatDialogueKeyHints(labels: Record<string, string>): string {
  return `${labels.KeyW}/${labels.KeyS}:Select  ${labels.KeyE}:Confirm  Esc:Close`;
}

const MOVE_THROTTLE_MS = 125; // match server TICK_RATE_MS

const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 }, ArrowUp: { dx: 0, dy: -1 },
  KeyA: { dx: -1, dy: 0 }, ArrowLeft: { dx: -1, dy: 0 },
  KeyS: { dx: 0, dy: 1 },  ArrowDown: { dx: 0, dy: 1 },
  KeyD: { dx: 1, dy: 0 },  ArrowRight: { dx: 1, dy: 0 },
};

const CODE_TO_DIRECTION: Record<string, string> = {
  KeyW: "north", ArrowUp: "north",
  KeyA: "west",  ArrowLeft: "west",
  KeyS: "south", ArrowDown: "south",
  KeyD: "east",  ArrowRight: "east",
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

  // Movement reconciliation state
  inputSeq: number = 0;
  pendingInputs: PendingInput[] = [];

  // Network send callback for movement
  onSendMove: ((direction: string, seq: number) => void) | null = null;
  onSendMoveStop: ((seq: number) => void) | null = null;

  // Dialogue mode
  private _dialogueMode = false;
  onDialogueAdvance: (() => void) | null = null;
  onDialogueChoose: ((optionId: string) => void) | null = null;
  onDialogueClose: (() => void) | null = null;
  onDialogueMoveSelection: ((delta: -1 | 1) => void) | null = null;
  onDialogueGetSelectedId: (() => string | null) | null = null;
  onDialogueIsText: (() => boolean) | null = null;

  private handleBlur = (): void => {
    const hadMovement = [...this.heldKeys].some((k) => k in MOVE_KEYS);
    this.heldKeys.clear();
    if (hadMovement) this.onSendMoveStop?.(this.inputSeq);
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
    const hadMovement = [...this.heldKeys].some((k) => k in MOVE_KEYS);
    this.heldKeys.clear();
    if (hadMovement) this.onSendMoveStop?.(this.inputSeq);
  }

  exitDialogueMode(): void {
    this._dialogueMode = false;
  }

  update(): void {
    if (!this.enabled || !this.playerAgent || this._dialogueMode) return;
    if (!this.displayState || !this.tiles) return;

    // Find the first held movement key
    for (const code of this.heldKeys) {
      const move = MOVE_KEYS[code];
      if (!move) continue;

      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;

      // Determine direction and send per-tick move message
      const direction = CODE_TO_DIRECTION[code];
      if (!direction) return;

      ++this.inputSeq;
      this.onSendMove?.(direction, this.inputSeq);

      // Local prediction
      const origin = this.displayState.getLocalPlayerPosition()
        ?? { x: this.playerAgent.x, y: this.playerAgent.y };
      const targetX = origin.x + move.dx;
      const targetY = origin.y + move.dy;

      this.displayState.predictMove(
        targetX, targetY, this.playerState, this.tiles,
      );

      // Always push regardless of predictMove result — the server may accept
      // moves the client rejects (different terrain knowledge). Reconciliation
      // handles correctness; gaps in the buffer cause desync.
      this.pendingInputs.push({ seq: this.inputSeq, direction: direction as any });

      // Safety valve
      if (this.pendingInputs.length > PENDING_INPUT_CAP) {
        this.pendingInputs = [];
      }

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

    // Track movement key presses and send direction to server.
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

  private getFacingDelta(): { dx: number; dy: number } | null {
    const facing = this.displayState?.getLocalPlayerFacing();
    if (!facing) return null;
    const FACING_DELTA: Record<string, { dx: number; dy: number }> = {
      north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 },
      east: { dx: 1, dy: 0 }, west: { dx: -1, dy: 0 },
    };
    return FACING_DELTA[facing] ?? null;
  }

  /** Facing tile from server position — entity positions and server validation both use server coords. */
  private getServerFacingTile(): { x: number; y: number } | null {
    if (!this.playerAgent) return null;
    const delta = this.getFacingDelta();
    if (!delta) return null;
    return { x: this.playerAgent.x + delta.dx, y: this.playerAgent.y + delta.dy };
  }

  private handleInteract(): void {
    if (!this.playerAgent) return;
    const { faction } = this.playerAgent;
    // Use server position for all interaction checks — entity positions
    // in nearbyEntities are server-authoritative, and the server validates
    // adjacency from its own position.
    const target = this.getServerFacingTile();
    if (!target) return;

    const atFacing = (e: NearbyEntity) => e.x === target.x && e.y === target.y;

    // 1. Merchant in front
    const merchant = this.nearbyEntities.find(
      (e) => e.role === "merchant" && atFacing(e),
    );
    if (merchant) {
      this.onModal?.({ type: "trade", merchantId: merchant.id });
      return;
    }

    // 2. Same-faction NPC in front
    const npc = this.nearbyEntities.find(
      (e) => e.faction === faction && e.controller !== "player" && e.hp > 0
        && atFacing(e),
    );
    if (npc) {
      this.send({ type: "talk", targetId: npc.id });
      return;
    }

    // 3. Gather from facing resource tile (bush)
    if (target) this.send({ type: "gather", resourceTile: target });
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);

    // When the released key was a movement key, check remaining held keys
    if (e.code in MOVE_KEYS) {
      // Find another held movement key to switch to
      const nextMove = [...this.heldKeys].find((k) => k in MOVE_KEYS);
      if (!nextMove) {
        this.onSendMoveStop?.(this.inputSeq);
      }
    }
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
