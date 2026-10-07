import { normalizePlayerName, randomPlayerName } from "@town-zero/shared";

// The name lives only in this browser. Storage can throw (private mode,
// blocked site data), so every access is guarded and the game works without it.
const NAME_KEY = "town-zero:name";
const HINT_KEY = "town-zero:rename-hint-seen";

function read(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

function write(storage: Storage, key: string, value: string): void {
  try { storage.setItem(key, value); } catch { /* the game works without it */ }
}

/** The stored name, or a new random one (saved at once, so the next visit keeps it). */
export function loadPlayerName(storage: Storage, rand?: () => number): { name: string; isNew: boolean } {
  const stored = normalizePlayerName(read(storage, NAME_KEY));
  if (stored) return { name: stored, isNew: false };
  const name = randomPlayerName(rand);
  write(storage, NAME_KEY, name);
  return { name, isNew: true };
}

export function savePlayerName(storage: Storage, name: string): void {
  write(storage, NAME_KEY, name);
}

// Without storage the hint counts as seen: it could never be dismissed.
export function renameHintSeen(storage: Storage): boolean {
  try { return storage.getItem(HINT_KEY) === "1"; } catch { return true; }
}

export function markRenameHintSeen(storage: Storage): void {
  write(storage, HINT_KEY, "1");
}
