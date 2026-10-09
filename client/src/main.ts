// client/src/main.ts
import { DEFAULT_VISION_RADIUS, TICK_RATE_MS, normalizePlayerName, playerColor } from "@town-zero/shared";
import type { Facing } from "@town-zero/shared";
import { NetworkClient } from "./network.js";
import { FogManager } from "./fog.js";
import { Camera } from "./camera.js";
import { Renderer } from "./renderer.js";
import { InputHandler, getKeyLabels, formatKeyHints, formatDialogueKeyHints } from "./input.js";
import { DisplayState } from "./display.js";
import { DialogueUI } from "./dialogue-ui.js";
import { actionHint, type ActionHint } from "./action-hint.js";
import { bindController } from "./controller.js";
import { TILE_SIZE } from "./constants.js";
import type { GameState } from "./types.js";
import { isStaleClient } from "./version.js";
import { leaveMessage, joinErrorMessage } from "./leave-message.js";
import { loadPlayerName, savePlayerName, renameHintSeen, markRenameHintSeen } from "./player-name.js";

// DOM elements
const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const connectingOverlay = document.getElementById("connecting-overlay")!;
const deathOverlay = document.getElementById("death-overlay")!;
const reviveBtn = document.getElementById("revive-btn") as HTMLButtonElement;
const errorOverlay = document.getElementById("error-overlay")!;
const errorText = document.getElementById("error-text")!;
const updateNotice = document.getElementById("update-notice")!;
const hpText = document.getElementById("hp-text")!;
const hpBar = document.getElementById("hp-bar")!;
const inventoryEl = document.getElementById("inventory")!;
const nameBtn = document.getElementById("name-btn")!;
const nameText = document.getElementById("name-text")!;
const nameInput = document.getElementById("name-input") as HTMLInputElement;
const nameHint = document.getElementById("name-hint")!;
const playerListEl = document.getElementById("player-list")!;

// Modules
const network = new NetworkClient();
const fog = new FogManager();
const camera = new Camera();
const renderer = new Renderer(canvas);
const displayState = new DisplayState();

let gameState: GameState = "connecting";
let input: InputHandler | null = null;
let isConnecting = false;
let reviveTimer: ReturnType<typeof setInterval> | null = null;

const dialogueUI = new DialogueUI("dialogue-overlay");
dialogueUI.onAdvance = () => network.sendDialogueAdvance();
dialogueUI.onChoose = (optionId) => network.sendDialogueChoose(optionId);
dialogueUI.onClose = () => network.sendDialogueClose();
const controller = bindController(() => input);
let controllerHidden = false;
let dialogueTimeoutAt: number | null = null;

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

  // After the join, every change of your name on the server is a rename it
  // took, so it is kept; a refused one never shows here. The join's name is
  // not kept: it can carry a number ("Quiet Otter 2") for a second tab.
  if (agent.name && agent.name !== serverName) {
    if (serverName !== null) {
      playerName = agent.name;
      savePlayerName(storage(), agent.name);
    }
    serverName = agent.name;
  }
  // The server's name, after its cleaning; not while the field is open.
  if (nameInput.classList.contains("hidden") && agent.name) {
    nameText.textContent = agent.name;
    nameBtn.style.color = playerColor(agent.name); // the color others see you in
  }
  updatePlayerList();
}

// --- Player name ---

// Reading window.localStorage itself can throw (blocked site data); an empty
// object makes every access throw, which player-name.ts handles.
function storage(): Storage {
  try { return window.localStorage; } catch { return {} as Storage; }
}

const { name: startName, isNew: newName } = loadPlayerName(storage());
let playerName = startName;
let serverName: string | null = null; // your name in the server state; null until the join
nameText.textContent = playerName;
nameBtn.style.color = playerColor(playerName);

// Only for a name the game picked, and only until the player renames or ~20 s pass.
const RENAME_HINT = nameHint.textContent;
if (newName && !renameHintSeen(storage())) {
  nameHint.classList.remove("hidden");
  setTimeout(hideRenameHint, 20_000);
}

function hideRenameHint(): void {
  // Not "That name is taken", which uses the same place.
  if (nameHint.textContent === RENAME_HINT) nameHint.classList.add("hidden");
  markRenameHintSeen(storage());
}

// Registered once: the network client lives across reconnects.
let takenNoteTimer: ReturnType<typeof setTimeout> | undefined;
network.onRenameRejected(() => {
  nameHint.textContent = "That name is taken";
  nameHint.classList.remove("hidden");
  // A new refusal shows for its full time; an older timer must not hide it.
  clearTimeout(takenNoteTimer);
  takenNoteTimer = setTimeout(() => nameHint.classList.add("hidden"), 4000);
});

function closeNameInput(): void {
  nameInput.classList.add("hidden");
  nameBtn.classList.remove("hidden");
}

nameBtn.addEventListener("click", () => {
  nameBtn.classList.add("hidden");
  nameInput.classList.remove("hidden");
  nameInput.value = serverName ?? playerName; // the name shown, which can carry a join number
  nameInput.focus();
  nameInput.select();
});

nameInput.addEventListener("keydown", (e) => {
  // Enter and Esc also accept or drop an input method (IME) candidate, for
  // example while typing a CJK name; that key press is not for the field.
  // Safari ends the composition before this keydown, so isComposing is false
  // there and only keyCode 229 tells.
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === "Escape") { closeNameInput(); nameBtn.focus(); return; }
  if (e.key !== "Enter") return;
  // Focus moves to the button below; without this the same Enter clicks it
  // and opens the field again.
  e.preventDefault();
  const name = normalizePlayerName(nameInput.value);
  if (name) {
    network.sendRename(name);
    hideRenameHint();
  }
  closeNameInput();
  // Back to the button for a keyboard user; not on blur, which moved focus on purpose.
  nameBtn.focus();
});
nameInput.addEventListener("blur", closeNameInput);

// Rebuilt only when a name, a death or the set of players changes.
let playerListKey = "";
function updatePlayerList(): void {
  const state = network.state;
  if (!state?.agents) return;
  const players: Array<{ name: string; color: string; dead: boolean; self: boolean }> = [];
  state.agents.forEach((a: any) => {
    if (a.role !== "player") return;
    const self = a.id === network.playerId;
    const name = a.name || a.id;
    players.push({ name, color: playerColor(name), dead: a.state === "dead", self });
  });
  players.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  const key = JSON.stringify(players);
  if (key === playerListKey) return;
  playerListKey = key;
  playerListEl.replaceChildren(...players.map((p) => {
    const li = document.createElement("li");
    li.classList.toggle("dead", p.dead);
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    // A plain swatch for everyone; "(you)" already marks you.
    swatch.style.background = p.color;
    const label = document.createElement("span");
    label.textContent = p.self ? `${p.name} (you)` : p.name; // textContent: names are untrusted
    li.append(swatch, label);
    return li;
  }));
}

// Player context for input handler
function updateInputContext(): void {
  if (!input || !network.state || !network.playerId) return;
  const state = network.state;
  const player = state.agents?.get(network.playerId);
  if (!player) return;

  input.setPlayerInfo(
    { x: player.x, y: player.y, faction: player.faction },
    player.state,  // FSM state for prediction gating
  );
}

// From the predicted tile and facing, so the hint follows a turn at once.
// The renderer draws it to the right of the player.
function computeActionHint(): ActionHint {
  const state = network.state;
  const playerId = network.playerId;
  const player = playerId ? state?.agents?.get(playerId) : undefined;
  const display = playerId ? displayState.get(playerId) : undefined;
  if (!state || !player || !display) return null;
  const agentAt = (x: number, y: number) => {
    let found: { faction: string; talkable: boolean } | undefined;
    state.agents.forEach((a: any) => {
      if (a.id !== playerId && a.state !== "dead" && a.x === x && a.y === y) found = a;
    });
    return found;
  };
  return actionHint(
    {
      x: display.displayX, y: display.displayY, facing: display.facing as Facing, faction: player.faction,
      carriesAnything: ["food", "material", "currency"].some((r) => (player.inventory?.get(r) ?? 0) > 0),
    },
    (x, y) => fog.getSnapshot(x, y),
    agentAt,
  );
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
    // aren't immediately overridden by an uninitialized state.
    const syncEntries: Array<[string, { x: number; y: number; facing: string }]> = [];
    const agentList: Array<{ id: string; x: number; y: number; role: string; faction: string; hp: number; maxHp: number }> = [];
    if (network.state?.agents) {
      network.state.agents.forEach((agent: any) => {
        syncEntries.push([agent.id, { x: agent.x, y: agent.y, facing: agent.facing }]);
        agentList.push({ id: agent.id, x: agent.x, y: agent.y, role: agent.role, faction: agent.faction, hp: agent.hp, maxHp: agent.maxHp });
      });
      // Sync non-local agents
      displayState.syncFromServer(syncEntries);

      // Reconcile local player
      if (input && network.playerId) {
        const localAgent = network.state.agents.get(network.playerId);
        if (localAgent) {
          input.pendingInputs = displayState.reconcileFromServer(
            network.playerId,
            {
              x: localAgent.x,
              y: localAgent.y,
              facing: localAgent.facing,
              lastProcessedInput: localAgent.lastProcessedInput,
              state: localAgent.state,
            },
            input.pendingInputs,
          );
        }
      }
    }

    updateInputContext();
    input?.update();
    updateHUD();

    // Dialogue timer
    if (dialogueTimeoutAt !== null && network.state) {
      const currentTick = network.state.tick ?? 0;
      const remainingTicks = dialogueTimeoutAt - currentTick;
      const remainingSeconds = remainingTicks * (TICK_RATE_MS / 1000);
      dialogueUI.updateTimer(remainingSeconds);
    }

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

    // In a dialogue E confirms, so the interact hint would be wrong.
    renderer.draw(network.state, fog, camera, network.playerId, displayState, input?.dialogueMode ? null : computeActionHint());
  }
  // The controller shows only in play, never over a dialogue or an overlay.
  const hidden = gameState !== "playing" || !!input?.dialogueMode;
  if (hidden && !controllerHidden) controller.release();
  controllerHidden = hidden;
  document.body.classList.toggle("hide-controller", hidden);
  requestAnimationFrame(gameLoop);
}

// Connect
// The server runs another build: this tab's code may not match its protocol.
let staleClient = false;

// An older server (rollback) has no presence handler, and Colyseus disconnects
// a client that sends an unregistered type. A stale client sends none; the
// server then counts it as visible and its idle timeout still applies.
function reportPresence(): void {
  if (!staleClient) network.sendPresence(!document.hidden);
}

// fromRetry: the player pressed Retry after a disconnect, which every deploy
// causes. A different build then means a deploy, so reload at once (the
// server is up, as the join worked). Only after Retry: on a first load a
// cached old page would otherwise reload forever.
async function connect(fromRetry = false): Promise<void> {
  if (isConnecting) return;
  isConnecting = true;

  gameState = "connecting";
  setOverlay("connecting");
  serverName = null; // a new join, a new agent: its first name is not a rename
  fog.clear();
  displayState.clear();

  try {
    await network.connect(playerName);
    // Same value as the HUD's %VITE_COMMIT% (vite.config.ts).
    staleClient = isStaleClient(import.meta.env.VITE_COMMIT, network.serverCommit);
    if (staleClient && fromRetry) {
      location.reload();
      return;
    }
    updateNotice.classList.toggle("hidden", !staleClient);
    reportPresence();

    const state = network.state;
    if (state) {
      camera.setGridSize(state.width, state.height);
      displayState.setGridSize(state.width, state.height);
    }

    input = new InputHandler();
    input.onSendInput = (frame) => network.sendInput(frame);
    input.onDialogueAdvance = () => network.sendDialogueAdvance();
    input.onDialogueChoose = (optionId) => network.sendDialogueChoose(optionId);
    input.onDialogueClose = () => network.sendDialogueClose();
    input.onDialogueMoveSelection = (delta) => dialogueUI.moveSelection(delta);
    input.onDialogueGetSelectedId = () => dialogueUI.getSelectedOptionId();
    input.onDialogueIsText = () => dialogueUI.isShowingText();
    displayState.setLocalPlayer(network.playerId);
    displayState.setTileSource(fog.tileSource());
    input.setPredictionContext(displayState, fog.tileSource());

    network.onVision((vision) => fog.update(vision));
    network.onLeft((code) => {
      gameState = "error";
      errorText.textContent = leaveMessage(code);
      setOverlay("error");
      input?.setEnabled(false);
      dialogueUI.hide();
    });
    network.onDeath(({ reviveInMs }) => {
      gameState = "dead";
      setOverlay("dead");
      input?.setEnabled(false);
      dialogueUI.hide();
      input?.exitDialogueMode();
      startReviveCountdown(reviveInMs);
    });
    network.onRevived(() => {
      // Snap to the village instead of gliding from the corpse. clear() also drops
      // the local player and tile source, which prediction needs.
      displayState.clear();
      displayState.setLocalPlayer(network.playerId);
      displayState.setTileSource(fog.tileSource());
      gameState = "playing";
      setOverlay("playing");
      input?.setEnabled(true);
    });

    // Dialogue wiring
    network.onDialogueState((payload) => {
      dialogueUI.show(payload);
      dialogueTimeoutAt = payload.timeoutAt;
      input?.enterDialogueMode();
    });
    network.onDialogueEnd(() => {
      dialogueUI.hide();
      dialogueTimeoutAt = null;
      input?.exitDialogueMode();
    });
    network.onDialogueError(() => {
      dialogueUI.hide();
      dialogueTimeoutAt = null;
      input?.exitDialogueMode();
    });

    gameState = "playing";
    setOverlay("playing");
  } catch (err: any) {
    gameState = "error";
    errorText.textContent = joinErrorMessage(err);
    setOverlay("error");
  } finally {
    isConnecting = false;
  }
}

// The server checks the delay too; the countdown only keeps the button honest.
function startReviveCountdown(ms: number): void {
  if (reviveTimer) clearInterval(reviveTimer);
  const readyAt = Date.now() + ms;
  const update = () => {
    const left = Math.ceil((readyAt - Date.now()) / 1000);
    reviveBtn.disabled = left > 0;
    reviveBtn.textContent = left > 0 ? `Revive (${left})` : "Revive";
    if (left <= 0 && reviveTimer) {
      clearInterval(reviveTimer);
      reviveTimer = null;
    }
  };
  update();
  reviveTimer = setInterval(update, 250);
}

reviveBtn.addEventListener("click", () => network.sendRevive());
document.addEventListener("visibilitychange", reportPresence);

document.getElementById("reload-btn")!.addEventListener("click", () => location.reload());

document.getElementById("retry-btn")!.addEventListener("click", () => {
  // A reconnect would run the old code again; a reload fetches the new build.
  if (staleClient) {
    location.reload();
    return;
  }
  network.disconnect();
  input?.destroy();
  displayState.clear();
  connect(true);
});

// Detect keyboard layout and update key hints
const keyHintsEl = document.getElementById("key-hints");
const dlgHintEl = document.querySelector(".dlg-hint");
getKeyLabels().then((labels) => {
  if (keyHintsEl) keyHintsEl.textContent = formatKeyHints(labels);
  if (dlgHintEl) dlgHintEl.textContent = formatDialogueKeyHints(labels);
});

// Start
requestAnimationFrame(gameLoop);
connect();
