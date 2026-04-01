import { Client } from "@colyseus/sdk";
import { Renderer } from "./renderer.js";
import { InputHandler } from "./input.js";
import { HUD } from "./ui.js";
import { FogOfWar } from "./fog.js";
import type { ActionCommand } from "@town-zero/shared";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const hud = new HUD();
const fog = new FogOfWar();

const serverUrl = `ws://${window.location.hostname}:2567`;
const client = new Client(serverUrl);

let playerId: string | null = null;

async function connect(): Promise<void> {
  const room = await client.joinOrCreate("game");

  room.onMessage("assignAgent", (data: { agentId: string }) => {
    playerId = data.agentId;
  });

  const input = new InputHandler(canvas, renderer, (cmd: ActionCommand) => {
    room.send("command", cmd);
  });

  function frame(): void {
    if (playerId) {
      const playerAgent = room.state.agents.get(playerId);
      if (playerAgent) {
        input.setPlayerPosition(playerAgent.x, playerAgent.y);
        renderer.centerOn(playerAgent.x, playerAgent.y);
        fog.update(playerAgent.x, playerAgent.y, 40, 40);
        hud.update({
          tick: room.state.tick,
          food: playerAgent.food,
          material: playerAgent.material,
          currency: playerAgent.currency,
          hp: playerAgent.hp,
          maxHp: playerAgent.maxHp,
        });
      }
    }

    renderer.render(room.state as any, playerId, fog);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

connect().catch((err) => {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f00";
  ctx.font = "20px monospace";
  ctx.fillText(`Connection failed: ${err.message}`, 20, 40);
});
