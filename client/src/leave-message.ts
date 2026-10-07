// What the error screen says when the server closes the room for us. The
// codes come from GameRoom.onJoin (server/src/rooms/GameRoom.ts).
export function leaveMessage(code: number): string {
  if (code === 4001) return "The village is full. Try again later.";
  if (code === 4000) return "There is no village to join.";
  return `Disconnected from the server (code ${code}). The game may have been updated.`;
}

/**
 * A failed join. A server refusal in onJoin reaches the client as a join
 * error with the close code (the Colyseus SDK's ServerError has .code), not
 * as a leave, so it is read here.
 */
export function joinErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 4000 || code === 4001) return leaveMessage(code);
  const message = (err as { message?: unknown } | null)?.message;
  return `Connection failed: ${typeof message === "string" ? message : String(err)}`;
}
