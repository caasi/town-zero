import type { DialogueStatePayload } from "@town-zero/shared";
import { DIALOGUE_TIMEOUT_TICKS } from "@town-zero/shared";
import { checkCondition, type EvalContext, interpolate } from "./evaluator.js";
import { DialogueSession } from "./dialogue-session.js";
import type { SimulationState } from "../simulation/tick.js";

type DialogueResult =
  | { ok: true; payload: DialogueStatePayload }
  | { ok: false; error: "busy" | "too_far" | "no_dialogue" | "not_in_dialogue" | "invalid_option" };

function buildPayload(session: DialogueSession, state: SimulationState): DialogueStatePayload {
  const msg = session.getState();
  const npc = state.agents.get(session.npcId)!;
  return {
    npcId: session.npcId,
    npcName: npc.role,
    nodeType: msg.type === "choice" ? "choice" : "text",
    speaker: msg.speaker || undefined,
    content: msg.text || undefined,
    options: msg.options?.map((opt) => ({ id: opt.id, label: opt.label, enabled: true })),
    timeoutAt: session.lastInteractionTick + DIALOGUE_TIMEOUT_TICKS,
  };
}

export function startDialogue(
  playerId: string,
  targetId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  const target = state.agents.get(targetId);
  if (!player || !target) return { ok: false, error: "no_dialogue" };

  // Adjacency check
  const dx = Math.abs(player.position.x - target.position.x);
  const dy = Math.abs(player.position.y - target.position.y);
  if (dx + dy !== 1) return { ok: false, error: "too_far" };

  // Busy check
  if (target.currentTalkingTo !== null) return { ok: false, error: "busy" };

  // Find dialogue tree for this NPC
  let treeId: string | null = null;
  for (const [id, tree] of state.dialogueTrees) {
    // Convention: tree ID contains the NPC ID
    if (id.startsWith(targetId)) {
      treeId = id;
      break;
    }
  }
  // Also check by NPC dialogue IDs if scenario loader stored them
  if (!treeId) {
    // Try finding any tree — for now use first available tree for this NPC
    for (const [id] of state.dialogueTrees) {
      if (id.includes(targetId)) {
        treeId = id;
        break;
      }
    }
  }
  if (!treeId) return { ok: false, error: "no_dialogue" };

  const tree = state.dialogueTrees.get(treeId)!;

  // Auto-face toward target
  const fdx = target.position.x - player.position.x;
  const fdy = target.position.y - player.position.y;
  if (Math.abs(fdx) >= Math.abs(fdy)) {
    player.facing = fdx > 0 ? "east" : "west";
  } else {
    player.facing = fdy > 0 ? "south" : "north";
  }

  // Evaluate entry points for conditional root
  let entryNodeId = tree.root;
  if (tree.entryPoints) {
    const beliefs = target.getAllBeliefs();
    const ctx: EvalContext = {
      beliefs,
      locals: new Map(),
      agentState: {
        player: { get: () => 0 },
        npc: { get: (p: string) => {
          if (p === "hp") return target.hp;
          if (p === "id") return target.id;
          const inv = target.inventory;
          if (p in inv) return inv[p as keyof typeof inv];
          return 0;
        }},
        settlement: null,
      },
      currentTick: state.tick,
    };
    for (const ep of tree.entryPoints) {
      if (checkCondition(ep.condition, ctx)) {
        entryNodeId = ep.nodeId;
        break;
      }
    }
  }

  // Create a modified tree with the resolved root
  const resolvedTree = entryNodeId === tree.root
    ? tree
    : { ...tree, root: entryNodeId };

  const session = new DialogueSession({
    tree: resolvedTree,
    npc: target,
    player,
    currentTick: state.tick,
    triggerRegistry: state.triggerRegistry,
  });

  // Lock both agents
  player.state = "talking";
  player.talkingToNpcId = targetId;
  target.currentTalkingTo = playerId;

  state.activeSessions.set(targetId, session);

  if (session.isEnded()) {
    endDialogue(targetId, state);
    return { ok: true, payload: buildPayload(session, state) };
  }

  return { ok: true, payload: buildPayload(session, state) };
}

export function advanceDialogue(
  playerId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  if (!player || !player.talkingToNpcId) return { ok: false, error: "not_in_dialogue" };

  const session = state.activeSessions.get(player.talkingToNpcId);
  if (!session || session.playerId !== playerId) return { ok: false, error: "not_in_dialogue" };

  session.updateTick(state.tick);
  const msg = session.advance();

  if (session.isEnded()) {
    endDialogue(player.talkingToNpcId, state);
  }

  return { ok: true, payload: buildPayload(session, state) };
}

export function chooseDialogue(
  playerId: string,
  optionId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  if (!player || !player.talkingToNpcId) return { ok: false, error: "not_in_dialogue" };

  const session = state.activeSessions.get(player.talkingToNpcId);
  if (!session || session.playerId !== playerId) return { ok: false, error: "not_in_dialogue" };

  session.updateTick(state.tick);

  try {
    session.select(optionId);
  } catch {
    return { ok: false, error: "invalid_option" };
  }

  if (session.isEnded()) {
    endDialogue(player.talkingToNpcId, state);
  }

  return { ok: true, payload: buildPayload(session, state) };
}

export function endDialogue(npcId: string, state: SimulationState): void {
  const session = state.activeSessions.get(npcId);
  if (!session) return;

  session.end();
  state.activeSessions.delete(npcId);

  const npc = state.agents.get(npcId);
  if (npc) npc.currentTalkingTo = null;

  const player = state.agents.get(session.playerId);
  if (player) {
    player.state = "idle";
    player.talkingToNpcId = null;
  }
}

export function tickDialogues(
  state: SimulationState,
): Array<{ playerId: string; npcId: string; reason: "timeout" }> {
  const expired: Array<{ playerId: string; npcId: string; reason: "timeout" }> = [];

  for (const [npcId, session] of state.activeSessions) {
    if (state.tick - session.lastInteractionTick >= DIALOGUE_TIMEOUT_TICKS) {
      expired.push({ playerId: session.playerId, npcId, reason: "timeout" });
    }
  }

  for (const { npcId } of expired) {
    endDialogue(npcId, state);
  }

  return expired;
}
