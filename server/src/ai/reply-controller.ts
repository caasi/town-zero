import type { ChooseFn } from "./jev.js";
import { describeGender } from "./npc-words.js";
import type { Agent } from "../simulation/agent.js";
import type { SimulationState } from "../simulation/tick.js";
import type { DialogueSession } from "../dialogue/dialogue-session.js";

// Tandi is short of food (docs/story.md); below this the state says "low".
const VILLAGE_FOOD_LOW = 40;

const instructions = (name: string, playerSaid: string | null) =>
  (playerSaid ? `The traveler said to ${name}: "${playerSaid}". ` : `${name} talks with a traveler. `)
  + `Pick the reply that ${name} would give, from the personality.`;

/** The Jev state for a reply, in words (spec 003, spec 004). */
export function describeReplyState(npc: Agent, playerSaid: string | null, state: SimulationState): Record<string, unknown> {
  // A villager is at home, so the live storehouse is what the NPC knows.
  const home = Array.from(state.settlements.values()).find((s) => s.populationIds.includes(npc.id));
  const food = home?.inventory.food;
  return {
    npc: `${npc.name}, ${/^[aeiou]/.test(npc.role) ? "an" : "a"} ${npc.role} of the village`,
    ...(npc.profile && {
      gender: describeGender(npc.name, npc.profile.gender),
      personality: npc.profile.personality,
    }),
    beliefs: Array.from(npc.getAllBeliefs().values()).map((f) => `${f.key.replace(/_/g, " ")}: ${String(f.value)}`),
    village: food === undefined ? "no village" : `the storehouse holds ${food} food${food < VILLAGE_FOOD_LOW ? " (low)" : ""}`,
    ...(playerSaid && { player_said: playerSaid }),
  };
}

/**
 * Asks Jev for the reply line of each dialogue that waits at a reply node.
 * GameRoom owns the chooser and sends the payload of each session that
 * update() returns. One call per reply visit: the session hands out the
 * request once.
 */
export class ReplyController {
  private answered = new Set<DialogueSession>();

  constructor(private choose: ChooseFn | null) {}

  /** Starts the calls that are due and returns the sessions answered since the last update. */
  update(state: SimulationState): DialogueSession[] {
    for (const session of state.activeSessions.values()) {
      const request = session.takeReplyRequest();
      if (!request) continue;
      const npc = state.agents.get(session.npcId);
      const fallback = request.lines[0].id;
      if (!this.choose || !npc) {
        this.answer(session, request.token, fallback);
        continue;
      }
      const options = Object.fromEntries(request.lines.map((l) => [l.id, l.description]));
      this.choose(describeReplyState(npc, request.playerLine, state), instructions(npc.name, request.playerLine), options)
        .then(({ id, usage }) => {
          const cost = usage ? ` (in ${usage.input}, out ${usage.output})` : "";
          console.log(`[jev] ${npc.id} replied ${id} from ${Object.keys(options).join(", ")}${cost}`);
          this.answer(session, request.token, id);
        })
        .catch((err) => {
          console.error(`[jev] reply failed for ${npc.id}:`, err);
          this.answer(session, request.token, fallback);
        });
    }
    const done = Array.from(this.answered).filter((s) => !s.isDisposed());
    this.answered.clear();
    return done;
  }

  private answer(session: DialogueSession, token: number, lineId: string): void {
    if (session.answerReply(token, lineId)) this.answered.add(session);
  }
}
