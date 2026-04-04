// client/src/dialogue-ui.ts
import type { DialogueStatePayload } from "@town-zero/shared";

export class DialogueUI {
  private container: HTMLElement;
  private speakerEl: HTMLElement;
  private contentEl: HTMLElement;
  private optionsEl: HTMLElement;
  private timerEl: HTMLElement;

  private selectedIndex = 0;
  private options: Array<{ id: string; label: string; enabled: boolean }> = [];
  private _requestPending = false;

  constructor(containerId: string) {
    this.container = document.getElementById(containerId)!;
    this.speakerEl = this.container.querySelector(".dlg-speaker")!;
    this.contentEl = this.container.querySelector(".dlg-content")!;
    this.optionsEl = this.container.querySelector(".dlg-options")!;
    this.timerEl = this.container.querySelector(".dlg-timer")!;
  }

  show(payload: DialogueStatePayload): void {
    this.container.classList.remove("hidden");

    this.speakerEl.textContent = payload.speaker ?? payload.npcName;

    this._requestPending = payload.nodeType === "request_pending";

    if (payload.nodeType === "text") {
      this.contentEl.textContent = payload.content ?? "";
      this.optionsEl.replaceChildren();
      this.options = [];
      this.contentEl.classList.remove("hidden");
      this.optionsEl.classList.add("hidden");
    } else if (payload.nodeType === "request_pending") {
      this.contentEl.textContent = payload.content ?? "Waiting for response…";
      this.optionsEl.replaceChildren();
      this.options = [];
      this.contentEl.classList.remove("hidden");
      this.optionsEl.classList.add("hidden");
    } else {
      this.contentEl.classList.add("hidden");
      this.options = payload.options ?? [];
      this.selectedIndex = this.options.findIndex((o) => o.enabled);
      if (this.selectedIndex < 0) this.selectedIndex = 0;
      this.renderOptions();
      this.optionsEl.classList.remove("hidden");
    }
  }

  hide(): void {
    this.container.classList.add("hidden");
    this.options = [];
    this.selectedIndex = 0;
  }

  moveSelection(delta: -1 | 1): void {
    if (this.options.length === 0) return;
    let next = this.selectedIndex + delta;
    if (next < 0) next = this.options.length - 1;
    if (next >= this.options.length) next = 0;

    // Skip disabled options (up to full cycle)
    const start = next;
    while (!this.options[next].enabled) {
      next += delta;
      if (next < 0) next = this.options.length - 1;
      if (next >= this.options.length) next = 0;
      if (next === start) break;
    }

    this.selectedIndex = next;
    this.renderOptions();
  }

  getSelectedOptionId(): string | null {
    if (this.options.length === 0) return null;
    const opt = this.options[this.selectedIndex];
    if (!opt || !opt.enabled) return null;
    return opt.id;
  }

  isShowingText(): boolean {
    return this.options.length === 0 && !this._requestPending && !this.container.classList.contains("hidden");
  }

  updateTimer(remainingSeconds: number): void {
    const clamped = Math.max(0, remainingSeconds);
    if (clamped <= 10) {
      this.timerEl.textContent = `${Math.ceil(clamped)}s`;
      this.timerEl.classList.remove("hidden");
      this.timerEl.classList.toggle("dlg-timer-warn", clamped <= 5);
    } else {
      this.timerEl.classList.add("hidden");
    }
  }

  private renderOptions(): void {
    const children: HTMLElement[] = [];
    for (let i = 0; i < this.options.length; i++) {
      const opt = this.options[i];
      const el = document.createElement("div");
      el.className = "dlg-option";
      if (i === this.selectedIndex) el.classList.add("selected");
      if (!opt.enabled) el.classList.add("disabled");
      el.textContent = opt.label;
      children.push(el);
    }
    this.optionsEl.replaceChildren(...children);
  }
}
