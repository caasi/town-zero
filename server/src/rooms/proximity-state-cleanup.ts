import type { SimulationState } from "../simulation/tick.js";

/**
 * Remove the given player id from every alive NPC's proximityState map on
 * disconnect. Called from GameRoom.onLeave. Ensures a reconnecting player
 * re-fires proximity:enter instead of inheriting stale ticksInRange.
 */
export function purgeProximityState(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    if (!agent.isAlive()) continue;
    agent.proximityState.delete(playerId);
  }
}
