import type { SimulationState } from "../simulation/tick.js";

/**
 * Remove the given player id from every NPC's proximity ledger.
 *
 * Called on player disconnect to discard stale per-player proximity state.
 * Today `GameRoom.onJoin` always allocates a fresh `player-N` id, so the
 * concrete benefit is keeping each NPC's cooldown ledger from growing
 * unbounded as players churn through the room. If reconnects later reuse
 * the same player id, this cleanup also ensures the returning player is
 * treated as a fresh proximity event by NPCs with `proximityBubble`
 * instead of inheriting a stale cooldown.
 *
 * Iterating all agents (including merchants and other bots) is intentional
 * and safe: `forgetPlayerProximity` is a no-op when the id is absent.
 */
export function purgeProximityLedger(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    agent.forgetPlayerProximity(playerId);
  }
}
