export type InteractKind = "talk" | "attack" | "gather" | "deposit";

/** What interact depends on, as the server knows it or the client sees it. */
export interface InteractFacts {
  /** The alive agent on the tile in front, or null. */
  occupant: { talks: boolean; sameFaction: boolean } | null;
  /** The tile in front has a resource with units left. */
  resourceInFront: boolean;
  /** The agent stands on a housing cell of a settlement. */
  onHousing: boolean;
}

/**
 * The interact rules, in priority order. The server (dispatchInteract) and
 * the client action hint both call this, so the two cannot drift apart.
 * Deposit is last: it reads the tile under the agent, the others the tile in front.
 */
export function resolveInteract(f: InteractFacts): InteractKind | null {
  if (f.occupant) {
    if (f.occupant.talks) return "talk";
    if (!f.occupant.sameFaction) return "attack";
  } else if (f.resourceInFront) {
    return "gather";
  }
  return f.onHousing ? "deposit" : null;
}
