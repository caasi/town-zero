export type InteractKind = "talk" | "attack" | "gather" | "deposit";

export interface InteractFacts {
  occupant: { talks: boolean; sameFaction: boolean } | null;
  resourceInFront: boolean;
  onHousing: boolean;
}

export function resolveInteract(f: InteractFacts): InteractKind | null {
  if (f.occupant) {
    if (f.occupant.talks) return "talk";
    if (!f.occupant.sameFaction) return "attack";
  } else if (f.resourceInFront) {
    return "gather";
  }
  return f.onHousing ? "deposit" : null;
}
