export class HUD {
  private lines: HTMLDivElement[] = [];
  private container: HTMLDivElement;

  constructor() {
    this.container = document.createElement("div");
    this.container.style.cssText = "position:fixed;top:10px;left:10px;color:#fff;font:14px monospace;background:rgba(0,0,0,0.7);padding:8px;border-radius:4px;pointer-events:none;";
    document.body.appendChild(this.container);

    for (let i = 0; i < 3; i++) {
      const line = document.createElement("div");
      this.container.appendChild(line);
      this.lines.push(line);
    }
  }

  update(info: { tick: number; food: number; material: number; currency: number; hp: number; maxHp: number }): void {
    this.lines[0].textContent = `Tick: ${info.tick}`;
    this.lines[1].textContent = `HP: ${info.hp}/${info.maxHp}`;
    this.lines[2].textContent = `Food: ${info.food} | Material: ${info.material} | Currency: ${info.currency}`;
  }
}
