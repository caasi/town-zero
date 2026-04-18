import type { SimulationState } from "../simulation/tick.js";

/**
 * Remove the given player id from every NPC's proximity ledger.
 *
 * Called on player disconnect so a future reconnect (same agent id) is treated
 * as a fresh proximity event by NPCs with `proximityBubble`. Without this,
 * the cooldown ledger would silently suppress reunion greetings.
 *
 * Iterating all agents (including merchants and other bots) is intentional
 * and safe: `forgetPlayerProximity` is a no-op when the id is absent.
 */
export function purgeProximityLedger(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    agent.forgetPlayerProximity(playerId);
  }
}
