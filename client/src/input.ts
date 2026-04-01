import type { Renderer } from "./renderer.js";
import type { ActionCommand } from "@town-zero/shared";

export type CommandCallback = (cmd: ActionCommand) => void;

export class InputHandler {
  private onCommand: CommandCallback;
  private playerPos: { x: number; y: number } = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    onCommand: CommandCallback,
  ) {
    this.onCommand = onCommand;
    this.canvas.addEventListener("click", (e) => this.handleClick(e));
  }

  setPlayerPosition(x: number, y: number): void {
    this.playerPos = { x, y };
  }

  private handleClick(e: MouseEvent): void {
    const gridPos = this.renderer.screenToGrid(e.clientX, e.clientY);
    const dx = gridPos.x - this.playerPos.x;
    const dy = gridPos.y - this.playerPos.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 1) {
      this.onCommand({ type: "move", target: gridPos });
    }
  }
}
