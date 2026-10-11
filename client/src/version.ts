export function isStaleClient(clientCommit: string, serverCommit: unknown): boolean {
  if (clientCommit === "dev") return false;
  return typeof serverCommit !== "string" || !serverCommit.startsWith(clientCommit);
}
