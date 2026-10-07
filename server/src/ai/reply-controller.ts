import type { ChooseFn } from "./jev.js";
import { describeGender } from "./npc-words.js";
import type { Agent } from "../simulation/agent.js";
import type { SimulationState } from "../simulation/tick.js";
import type { DialogueSession } from "../dialogue/dialogue-session.js";
import { isStoreFoodKey } from "../simulation/vision.js";

// Tandi is short of food (docs/story.md); below this the state says "low".
const VILLAGE_FOOD_LOW = 40;
const CACHE_SIZE = 1000;

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
    // Store counts change with every deposit; in the state they would make each
    // reply a new cache key. The village line below gives the count.
    beliefs: Array.from(npc.getAllBeliefs().values())
      .filter((f) => !isStoreFoodKey(f.key))
      .map((f) => `${f.key.replace(/_/g, " ")}: ${String(f.value)}`),
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
  // Jev answers arrive between ticks. They wait here and reach the session
  // in update(), on the tick that sends them, so no advance can skip a picked
  // line that the client has not seen.
  private arrived: Array<{ session: DialogueSession; token: number; lineId: string }> = [];
  // Jev picks the same line for the same input (spec 004 runs: 3/3 and 4/4),
  // so a pick is kept by everything Jev saw. This bounds the cost of a player
  // who asks the same question again and again; a new state asks again.
  // ponytail: oldest-first eviction at a fixed size; an LRU if hits matter.
  private cache = new Map<string, string>();

  constructor(private choose: ChooseFn | null) {}

  /** Starts the calls that are due and returns the sessions answered since the last update. */
  update(state: SimulationState): DialogueSession[] {
    for (const { session, token, lineId } of this.arrived.splice(0)) this.answer(session, token, lineId);
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
      const words = describeReplyState(npc, request.playerLine, state);
      const text = instructions(npc.name, request.playerLine);
      const key = JSON.stringify([npc.id, request.nodeKey, words, text, options]);
      const ids = Object.keys(options).join(", ");
      const cached = this.cache.get(key);
      if (cached !== undefined) {
        console.log(`[jev] ${npc.id} replied ${cached} from ${ids} (cached)`);
        this.answer(session, request.token, cached);
        continue;
      }
      this.choose(words, text, options)
        .then(({ id, usage }) => {
          const cost = usage ? ` (in ${usage.input}, out ${usage.output})` : "";
          console.log(`[jev] ${npc.id} replied ${id} from ${ids}${cost}`);
          this.remember(key, id);
          this.arrived.push({ session, token: request.token, lineId: id });
        })
        .catch((err) => {
          console.error(`[jev] reply failed for ${npc.id}:`, err);
          this.arrived.push({ session, token: request.token, lineId: fallback });
        });
    }
    const done = Array.from(this.answered).filter((s) => !s.isDisposed());
    this.answered.clear();
    return done;
  }

  private remember(key: string, lineId: string): void {
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, lineId);
  }

  private answer(session: DialogueSession, token: number, lineId: string): void {
    if (session.answerReply(token, lineId)) this.answered.add(session);
  }
}
