// client/src/main.ts
import { MERCHANT_TRADE_RATE, DEFAULT_VISION_RADIUS } from "@town-zero/shared";
import { NetworkClient } from "./network.js";
import { FogManager } from "./fog.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { InputHandler, getKeyLabels, formatKeyHints } from "./input.js";
import { DisplayState } from "./display.js";
import { TILE_SIZE } from "./constants.js";
import type { GameState, ModalRequest } from "./types.js";

// DOM elements
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const connectingOverlay = document.getElementById("connecting-overlay")!;
const deathOverlay = document.getElementById("death-overlay")!;
const errorOverlay = document.getElementById("error-overlay")!;
const errorText = document.getElementById("error-text")!;
const tradeModal = document.getElementById("trade-modal")!;
const hpText = document.getElementById("hp-text")!;
const hpBar = document.getElementById("hp-bar")!;
const inventoryEl = document.getElementById("inventory")!;

// Modules
const network = new NetworkClient();
const fog = new FogManager();
const camera = new Camera();
const renderer = new Renderer(canvas);
const displayState = new DisplayState();

let gameState: GameState = "connecting";
let input: InputHandler | null = null;
let currentTradeTarget: string | null = null;
let isConnecting = false;

// Resize canvas to fill window
function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.setCanvasSize(canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// HUD update
function updateHUD(): void {
  const state = network.state;
  const playerId = network.playerId;
  if (!state || !playerId) return;

  const agent = state.agents?.get(playerId);
  if (!agent) return;

  hpText.textContent = `HP: ${agent.hp}/${agent.maxHp}`;
  const pct = Math.max(0, (agent.hp / agent.maxHp) * 100);
  hpBar.style.width = `${pct}%`;
  hpBar.style.background = pct > 50 ? "#4a4" : pct > 25 ? "#aa4" : "#a44";

  const food = agent.inventory?.get("food") ?? 0;
  const material = agent.inventory?.get("material") ?? 0;
  const currency = agent.inventory?.get("currency") ?? 0;
  inventoryEl.textContent = `🍖${food} 🪵${material} 💰${currency}`;
}

// Get nearby entities for input handler
function updateInputContext(): void {
  if (!input || !network.state || !network.playerId) return;
  const state = network.state;
  const player = state.agents?.get(network.playerId);
  if (!player) return;

  const nearby: any[] = [];
  state.agents?.forEach((agent: any) => {
    if (agent.id !== network.playerId) {
      nearby.push({
        id: agent.id, x: agent.x, y: agent.y,
        faction: agent.faction, role: agent.role,
        controller: agent.controller, hp: agent.hp,
      });
    }
  });

  // Find settlement at player position
  let settlementId: string | null = null;
  const playerTile = state.tiles?.get(`${player.x},${player.y}`);
  if (playerTile?.ownerFaction) {
    state.settlements?.forEach((s: any) => {
      if (s.faction === playerTile.ownerFaction) settlementId = s.id;
    });
  }

  input.setPlayerInfo(
    { x: player.x, y: player.y, faction: player.faction },
    nearby,
    settlementId,
    player.state,  // FSM state for prediction gating
  );
}

// Trade modal
function openTradeModal(merchantId: string): void {
  currentTradeTarget = merchantId;
  tradeModal.classList.remove("hidden");
  input?.setEnabled(false);
}

function closeTradeModal(): void {
  currentTradeTarget = null;
  tradeModal.classList.add("hidden");
  input?.setEnabled(true);
}

document.getElementById("sell-food-btn")!.addEventListener("click", () => {
  if (currentTradeTarget) {
    network.send({
      type: "trade", targetId: currentTradeTarget,
      offer: "food", offerAmount: MERCHANT_TRADE_RATE,
      want: "currency", wantAmount: 1,
    });
    closeTradeModal();
  }
});

document.getElementById("sell-material-btn")!.addEventListener("click", () => {
  if (currentTradeTarget) {
    network.send({
      type: "trade", targetId: currentTradeTarget,
      offer: "material", offerAmount: MERCHANT_TRADE_RATE,
      want: "currency", wantAmount: 1,
    });
    closeTradeModal();
  }
});

document.getElementById("close-trade-btn")!.addEventListener("click", closeTradeModal);
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape") closeTradeModal();
});

// Modal handler for input
function handleModal(req: ModalRequest): void {
  if (req.type === "trade") {
    openTradeModal(req.merchantId);
  } else if (req.type === "dialogue") {
    network.send({ type: "talk", targetId: req.targetId, optionId: "greet" });
  }
}

// Overlay management
function setOverlay(state: GameState): void {
  connectingOverlay.classList.toggle("hidden", state !== "connecting");
  deathOverlay.classList.toggle("hidden", state !== "dead");
  errorOverlay.classList.toggle("hidden", state !== "error");
}

// Game loop
let lastFrameTime = performance.now();

function gameLoop(now: number): void {
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  if (gameState === "playing") {
    // Sync display positions from server BEFORE input so predictions
    // aren't immediately overridden by an uninitialized lastServerPos.
    const syncEntries: Array<[string, { x: number; y: number }]> = [];
    const agentList: Array<{ id: string; x: number; y: number; role: string; faction: string }> = [];
    if (network.state?.agents) {
      network.state.agents.forEach((agent: any) => {
        syncEntries.push([agent.id, { x: agent.x, y: agent.y }]);
        agentList.push({ id: agent.id, x: agent.x, y: agent.y, role: agent.role, faction: agent.faction });
      });
      displayState.syncFromServer(syncEntries);
    }

    updateInputContext();
    input?.update();
    updateHUD();

    // Lerp all render positions
    displayState.updateRender(dt);

    const player = network.state?.agents?.get(network.playerId ?? "");
    if (player) {
      // Fog reveal uses stable predicted tile coords (displayX/Y) to
      // avoid mid-lerp rounding artifacts. Camera uses lerped pixel
      // position for smooth visual tracking.
      const playerDisplay = displayState.get(network.playerId!);
      if (playerDisplay) {
        fog.revealAround(playerDisplay.displayX, playerDisplay.displayY, DEFAULT_VISION_RADIUS, network.state?.tiles, agentList, network.playerId);
        camera.update(playerDisplay.renderX / TILE_SIZE, playerDisplay.renderY / TILE_SIZE);
      } else {
        fog.revealAround(player.x, player.y, DEFAULT_VISION_RADIUS, network.state?.tiles, agentList, network.playerId);
        camera.update(player.x, player.y);
      }
    }

    renderer.draw(network.state, fog, camera, network.playerId, displayState);
  }
  requestAnimationFrame(gameLoop);
}

// Connect
async function connect(): Promise<void> {
  if (isConnecting) return;
  isConnecting = true;

  gameState = "connecting";
  setOverlay("connecting");
  fog.clear();
  displayState.clear();

  try {
    await network.connect("Player");

    const state = network.state;
    if (state) {
      camera.setGridSize(state.width, state.height);
    }

    input = new InputHandler((cmd) => network.send(cmd));
    input.setModalHandler(handleModal);
    displayState.setLocalPlayer(network.playerId);
    input.setPredictionContext(displayState, fog.tileSource());

    network.onVision((vision) => fog.update(vision));
    network.onDeath(() => {
      gameState = "dead";
      setOverlay("dead");
      input?.setEnabled(false);
    });

    gameState = "playing";
    setOverlay("playing");
  } catch (err: any) {
    gameState = "error";
    errorText.textContent = `Connection failed: ${err.message ?? err}`;
    setOverlay("error");
  } finally {
    isConnecting = false;
  }
}

// Rejoin / retry buttons
document.getElementById("rejoin-btn")!.addEventListener("click", () => {
  network.disconnect();
  input?.destroy();
  displayState.clear();
  connect();
});

document.getElementById("retry-btn")!.addEventListener("click", () => {
  network.disconnect();
  input?.destroy();
  displayState.clear();
  connect();
});

// Detect keyboard layout and update key hints
const keyHintsEl = document.getElementById("key-hints");
if (keyHintsEl) {
  getKeyLabels().then((labels) => {
    keyHintsEl.textContent = formatKeyHints(labels);
  });
}

// Start
requestAnimationFrame(gameLoop);
connect();
