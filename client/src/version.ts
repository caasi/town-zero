// The client's commit is the short SHA from the HUD (vite.config.ts); the
// server sends the full SHA, so a prefix match compares the two without a
// second copy of the shortening rule.
export function isStaleClient(clientCommit: string, serverCommit: unknown): boolean {
  if (clientCommit === "dev") return false;
  return typeof serverCommit !== "string" || !serverCommit.startsWith(clientCommit);
}
