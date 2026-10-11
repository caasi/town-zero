import type { SimulationState } from "../simulation/tick.js";

export function purgeProximityState(state: SimulationState, playerId: string): void {
  for (const agent of state.agents.values()) {
    if (agent.controller === "player") continue;
    agent.proximityState.delete(playerId);
  }
}
