// client/src/input.ts
import type { InputFrame, Facing } from "@town-zero/shared";
import { PENDING_INPUT_CAP } from "@town-zero/shared";
import type { DisplayState } from "./display.js";

interface AgentInfo {
  x: number;
  y: number;
  faction: string;
}


const ACTION_CODES = ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE"] as const;

const QWERTY_LABELS: Record<string, string> = {
  KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D",
  KeyE: "E",
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
  return `${move}:Move  ${labels.KeyE}:Interact`;
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
  TouchUp: { dx: 0, dy: -1 }, TouchLeft: { dx: -1, dy: 0 },
  TouchDown: { dx: 0, dy: 1 }, TouchRight: { dx: 1, dy: 0 },
};

const CODE_TO_DIRECTION: Record<string, Facing> = {
  KeyW: "north", ArrowUp: "north",
  KeyA: "west",  ArrowLeft: "west",
  KeyS: "south", ArrowDown: "south",
  KeyD: "east",  ArrowRight: "east",
  TouchUp: "north", TouchLeft: "west", TouchDown: "south", TouchRight: "east",
};

// Own codes, so a D-pad release never drops a key held on a keyboard.
const TOUCH_CODES = ["TouchUp", "TouchDown", "TouchLeft", "TouchRight"] as const;
export type TouchCode = typeof TOUCH_CODES[number];

export class InputHandler {
  private lastMoveTime = 0;
  private enabled = true;

  // Updated each tick by main loop
  private playerAgent: AgentInfo | null = null;

  // Movement prediction
  private displayState: DisplayState | null = null;
  private tiles: { get(key: string): { terrain: string } | undefined } | null = null;
  private playerState: string = "idle";

  // Held-key tracking for continuous movement
  private heldKeys = new Set<string>();

  // Movement reconciliation state
  inputSeq: number = 0;
  pendingInputs: InputFrame[] = [];

  // Network send callbacks
  onSendInput: ((frame: InputFrame) => void) | null = null;

  // Dialogue mode
  private _dialogueMode = false;
  onDialogueAdvance: (() => void) | null = null;
  onDialogueChoose: ((optionId: string) => void) | null = null;
  onDialogueClose: (() => void) | null = null;
  onDialogueMoveSelection: ((delta: -1 | 1) => void) | null = null;
  onDialogueGetSelectedId: (() => string | null) | null = null;
  onDialogueIsText: (() => boolean) | null = null;

  // Moves already sent stay in pendingInputs: the server still runs them, and
  // reconciliation drops each one once lastProcessedInput covers it.
  private handleBlur = (): void => {
    this.heldKeys.clear();
  };

  constructor() {
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

  setPlayerInfo(agent: AgentInfo | null, agentState?: string): void {
    this.playerAgent = agent;
    this.playerState = agentState ?? "idle";
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
    // The talk frame has run, so every earlier frame is acknowledged; every
    // later one is refused by the dialogue lock (the server acknowledges it a
    // tick or two later, one frame per tick). Drop them now so the player is
    // not drawn moving during that gap.
    this.pendingInputs = [];
  }

  exitDialogueMode(): void {
    this._dialogueMode = false;
  }

  update(): void {
    if (!this.enabled || !this.playerAgent || this._dialogueMode) return;
    // A key held when the name field took focus would keep moving the player:
    // keydown ignores the field, but update() reads held keys every frame.
    if (document.activeElement instanceof HTMLInputElement) {
      this.heldKeys.clear();
      return;
    }
    if (!this.displayState || !this.tiles) return;

    // Use the most recently pressed movement key (last in Set insertion order)
    const heldArray = [...this.heldKeys];
    let activeCode: string | undefined;
    for (let i = heldArray.length - 1; i >= 0; i--) {
      if (heldArray[i] in MOVE_KEYS) { activeCode = heldArray[i]; break; }
    }
    if (activeCode) {
      const move = MOVE_KEYS[activeCode]!;

      const now = Date.now();
      if (now - this.lastMoveTime < MOVE_THROTTLE_MS) return;
      this.lastMoveTime = now;

      // Determine direction and send per-tick move message
      const direction = CODE_TO_DIRECTION[activeCode];
      if (!direction) return;

      ++this.inputSeq;
      const frame: InputFrame = { seq: this.inputSeq, direction };
      this.onSendInput?.(frame);

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
      this.pendingInputs.push(frame);

      // Safety valve
      if (this.pendingInputs.length > PENDING_INPUT_CAP) {
        this.pendingInputs = [];
      }

      return;
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.enabled) return;
    // Typing in a text field (the name field) is not a game key.
    if (e.target instanceof HTMLInputElement) return;

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
    // Delete+re-add so most recently pressed key is last in Set iteration order.
    if (code in MOVE_KEYS) {
      e.preventDefault();
      this.heldKeys.delete(code);
      this.heldKeys.add(code);
      return;
    }

    // Block repeat for action keys
    if (e.repeat) return;

    if (code === "KeyE") this.interact();
  }

  /** The E key and the touch Action button. */
  interact(): void {
    if (!this.enabled || !this.playerAgent || this._dialogueMode) return;
    // As for E: no game action while the name field is open.
    if (document.activeElement instanceof HTMLInputElement) return;

    ++this.inputSeq;
    const frame: InputFrame = { seq: this.inputSeq, action: { type: "interact" } };
    this.onSendInput?.(frame);
    this.pendingInputs.push(frame);
  }

  /**
   * The touch D-pad holds one touch code at a time, so update() moves the
   * player as it does for a held key. null releases it.
   */
  setTouchDirection(code: TouchCode | null): void {
    for (const c of TOUCH_CODES) if (c !== code) this.heldKeys.delete(c);
    if (code && !this.heldKeys.has(code)) this.heldKeys.add(code);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.code);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.handleKey);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    document.removeEventListener("visibilitychange", this.handleBlur);
    this.heldKeys.clear();
  }
}
