import { JOIN_REFUSED_FULL, JOIN_REFUSED_NO_VILLAGE } from "@town-zero/shared";

// What the error screen says when the server closes the room for us. Only the
// game's own refusal codes get their own text; the codes of Colyseus (4001 is
// sent on every deploy) keep the deploy text.
export function leaveMessage(code: number): string {
  if (code === JOIN_REFUSED_FULL) return "The village is full. Try again later.";
  if (code === JOIN_REFUSED_NO_VILLAGE) return "There is no village to join.";
  return `Disconnected from the server (code ${code}). The game may have been updated.`;
}

/**
 * A failed join. A refusal in onJoin reaches the client as a join error with
 * the close code (the Colyseus SDK's ServerError has .code), not as a leave.
 */
export function joinErrorMessage(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === JOIN_REFUSED_FULL || code === JOIN_REFUSED_NO_VILLAGE) return leaveMessage(code);
  const message = (err as { message?: unknown } | null)?.message;
  return `Connection failed: ${typeof message === "string" ? message : String(err)}`;
}
