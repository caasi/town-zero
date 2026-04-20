import type { DialogueStatePayload } from "@town-zero/shared";
import { DIALOGUE_TIMEOUT_TICKS } from "@town-zero/shared";
import { DialogueSession } from "./dialogue-session.js";
import type { SimulationState } from "../simulation/tick.js";
import { findTreeIdForNpc, resolveDialogueEntryNode } from "../simulation/dialogue-entry-predicate.js";
import { dispatch, applyEventEffects } from "../simulation/event-dispatch.js";
import type { TalkEndPayload } from "@town-zero/shared/script-dsl";

export type DialogueResult =
  | { ok: true; payload: DialogueStatePayload; ended: boolean }
  | { ok: false; error: "busy" | "too_far" | "no_dialogue" | "not_in_dialogue" | "invalid_option" | "wrong_node_type" };

function nodeTypeFromMsg(type: string): DialogueStatePayload["nodeType"] {
  if (type === "choice") return "choice";
  if (type === "request_pending") return "request_pending";
  return "text";
}

function buildPayload(session: DialogueSession, state: SimulationState): DialogueStatePayload {
  const msg = session.getState();
  const npc = state.agents.get(session.npcId)!;
  return {
    npcId: session.npcId,
    npcName: npc.name,
    nodeType: nodeTypeFromMsg(msg.type),
    speaker: msg.speaker || undefined,
    content: msg.text || undefined,
    options: msg.type === "choice" ? session.getOptionsWithStatus() : undefined,
    timeoutAt: session.lastInteractionTick + DIALOGUE_TIMEOUT_TICKS,
  };
}

export function endDialogue(
  npcId: string,
  state: SimulationState,
  reason: TalkEndPayload["reason"] = "completed",
): void {
  const session = state.activeSessions.get(npcId);
  if (!session) return;
  const npc = state.agents.get(npcId);
  const player = state.agents.get(session.playerId);
  if (npc && player) {
    const selfRef = { id: npc.id, faction: npc.faction, role: npc.role, position: { ...npc.position } };
    const playerRef = { id: player.id, faction: player.faction, role: player.role, position: { ...player.position } };
    const effs = dispatch(npc, "talk:end", { tick: state.tick, self: selfRef, player: playerRef, reason });
    applyEventEffects(effs, state);
  }
  session.dispose();
  state.activeSessions.delete(npcId);
}

export function startDialogue(
  playerId: string,
  targetId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  const target = state.agents.get(targetId);
  if (!player || !target) return { ok: false, error: "no_dialogue" };

  // Prevent overlapping dialogue sessions for the same player
  if (player.talkingToNpcId !== null) {
    return { ok: false, error: "busy" };
  }

  // Adjacency check
  const dx = Math.abs(player.position.x - target.position.x);
  const dy = Math.abs(player.position.y - target.position.y);
  if (dx + dy !== 1) return { ok: false, error: "too_far" };

  // Busy check
  if (target.currentTalkingTo !== null) return { ok: false, error: "busy" };

  // Find dialogue tree for this NPC
  const treeId = findTreeIdForNpc(targetId, state);
  if (!treeId) return { ok: false, error: "no_dialogue" };
  const tree = state.dialogueTrees.get(treeId)!;

  // Auto-face both agents toward each other
  const fdx = target.position.x - player.position.x;
  const fdy = target.position.y - player.position.y;
  if (Math.abs(fdx) >= Math.abs(fdy)) {
    player.facing = fdx > 0 ? "east" : "west";
    target.facing = fdx > 0 ? "west" : "east";
  } else {
    player.facing = fdy > 0 ? "south" : "north";
    target.facing = fdy > 0 ? "north" : "south";
  }

  // Evaluate entry points for conditional root
  const entryNodeId = resolveDialogueEntryNode(player, target, state) ?? tree.root;

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

  // Lock both agents and stop any queued actions
  player.inputQueue = [];
  target.inputQueue = [];
  target.planBacklog = [];
  player.talkingToNpcId = targetId;
  target.currentTalkingTo = playerId;
  state.activeSessions.set(targetId, session);

  // Clear any active speech bubble up front so it can't render alongside the
  // dialogue UI for NPCs that don't register a talk:start handler. Handlers
  // may still re-set a bubble via the bubble effect below.
  target.setBubble("", 0, state.tick);

  const selfRef = { id: target.id, faction: target.faction, role: target.role, position: { ...target.position } };
  const playerRef = { id: player.id, faction: player.faction, role: player.role, position: { ...player.position } };
  const effs = dispatch(target, "talk:start", {
    tick: state.tick, self: selfRef, player: playerRef, dialogueId: treeId,
  });
  applyEventEffects(effs, state);

  // Build payload — if this throws, dispose cleans up the locks
  try {
    const ended = session.isEnded();
    if (ended) {
      const payload = buildPayload(session, state);
      endDialogue(targetId, state);
      return { ok: true, payload, ended: true };
    }
    return { ok: true, payload: buildPayload(session, state), ended: false };
  } catch (err) {
    console.error(`[session-manager] startDialogue buildPayload failed for ${playerId} → ${targetId}:`, err);
    endDialogue(targetId, state);
    return { ok: false, error: "no_dialogue" };
  }
}

export function advanceDialogue(
  playerId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  if (!player || !player.talkingToNpcId) return { ok: false, error: "not_in_dialogue" };

  const npcId = player.talkingToNpcId;
  const session = state.activeSessions.get(npcId);
  if (!session || session.playerId !== playerId) return { ok: false, error: "not_in_dialogue" };

  session.updateTick(state.tick);

  try {
    session.advance();
  } catch {
    return { ok: false, error: "wrong_node_type" };
  }

  try {
    const ended = session.isEnded();
    if (ended) {
      const payload = buildPayload(session, state);
      endDialogue(npcId, state);
      return { ok: true, payload, ended: true };
    }
    return { ok: true, payload: buildPayload(session, state), ended };
  } catch (err) {
    console.error(`[session-manager] advanceDialogue buildPayload failed for ${playerId}:`, err);
    endDialogue(npcId, state);
    return { ok: false, error: "not_in_dialogue" };
  }
}

export function chooseDialogue(
  playerId: string,
  optionId: string,
  state: SimulationState,
): DialogueResult {
  const player = state.agents.get(playerId);
  if (!player || !player.talkingToNpcId) return { ok: false, error: "not_in_dialogue" };

  const npcId = player.talkingToNpcId;
  const session = state.activeSessions.get(npcId);
  if (!session || session.playerId !== playerId) return { ok: false, error: "not_in_dialogue" };

  session.updateTick(state.tick);

  try {
    session.select(optionId);
  } catch {
    return { ok: false, error: "invalid_option" };
  }

  try {
    const ended = session.isEnded();
    if (ended) {
      const payload = buildPayload(session, state);
      endDialogue(npcId, state);
      return { ok: true, payload, ended: true };
    }
    return { ok: true, payload: buildPayload(session, state), ended };
  } catch (err) {
    console.error(`[session-manager] chooseDialogue buildPayload failed for ${playerId}:`, err);
    endDialogue(npcId, state);
    return { ok: false, error: "not_in_dialogue" };
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
    endDialogue(npcId, state, "timeout");
  }

  return expired;
}
