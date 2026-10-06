const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 5_000;

/** Picks one option id. `options` maps option id → plain-language description. */
export type ChooseFn = (
  state: unknown,
  instructions: string,
  options: Record<string, string>,
) => Promise<string>;

/** Jev (TypeSafe AI) Choice question. See https://docs.typesafe.ai/api.md */
export function jevChooser(apiKey: string, fetchFn: typeof fetch = fetch): ChooseFn {
  return async (state, instructions, options) => {
    const res = await fetchFn(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state,
        questions: { next: { type: "choice", instructions, criteria: options } },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
    const body = (await res.json()) as { answers?: { next?: { choice?: unknown } } };
    const choice = body.answers?.next?.choice;
    // The answer comes from outside the server: accept only an id we offered.
    if (typeof choice !== "string" || !Object.hasOwn(options, choice)) {
      throw new Error(`Jev returned an unknown choice: ${String(choice)}`);
    }
    return choice;
  };
}
