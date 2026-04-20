import type { SimulationState } from "../simulation/tick.js";

/**
 * Remove the given player id from every NPC's proximityState map on
 * disconnect. Called from GameRoom.onLeave. Ensures a reconnecting player
 * re-fires proximity:enter instead of inheriting stale ticksInRange.
 *
 * Dead NPCs are intentionally included: they remain in `state.agents` (only
 * merchants are purged in `processMerchantTick`), and without this their
 * proximityState entries for disconnected players would leak forever. The
 * `delete` is a cheap no-op if the key is absent.
 */
export function purgeProximityState(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    if (agent.controller === "player") continue;
    agent.proximityState.delete(playerId);
  }
}
