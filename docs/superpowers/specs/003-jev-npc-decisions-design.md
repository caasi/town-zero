# 003 — AI NPC decisions with Jev

Status: implemented on `feat/jev-beasts`.
Supersedes: MVP spec Section 5 "LLM Integration" (call frequency, input summary, JSON output, Dialogue Gate) and the "Bot / LLM Integration" part of the unified-input-frame spec.

## Goal

An AI NPC must choose only from a short list of options that the game gives it. The demo target is randomly generated quests and NPCs with a personality. This design is the first step: den beasts.

## Why not a writing LLM

The earlier design asked an LLM for a free JSON array of `FrameAction`s. It could not work:

- The prompt gave no facing, no way to move and no target ids. `gather`, `attack` and `talk` act only on the facing tile, so every plan was a no-op.
- Nothing limited what the model could ask for, so the server had to validate free text.
- The scheduler was never connected, and no LLM client existed.

## Jev

Jev (TypeSafe AI) does not write text. It answers typed questions about a given state. A `choice` question returns one of the option ids you give it, with a probability for each option and a confidence value.

- Endpoint: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer $TYPESAFE_API_KEY`.
- Measured in a spike: about 0.3 s for one call. Price: $0.042 per million input tokens (TypeSafe documentation).
- Known limits of jev-1.13 (TypeSafe documentation, "model jaggedness"):
  - weak at spatial reasoning, numbers and multi-step reasoning;
  - leans toward the first option of a `choice`;
  - accuracy drops when the state contains content that is not related to the decision.

Docs: https://docs.typesafe.ai/llms.txt

## Design

"Code lists the options, Jev picks one, code acts."

```
JevController.update(state)            // GameRoom, once per tick, before processTick
  for each alive agent with controller "llm" and an empty planBacklog:
    goal exists and nextFrame(goal) gives a frame → planBacklog = [frame]
    else → clear goal, ask Jev (one call in flight per agent)
```

### Options (`buildOptions`)

| id | Offered when | Goal |
|----|--------------|------|
| `rest` | always (first, so the first-option bias lands on the safest choice) | idle ~3 s |
| `guard_den` | the agent has a den, and the first step toward a random tile within 3 steps of the den core is possible | walk there, ~5 s at most |
| `forage` | the agent carries less than 5 food and remembers a food tile (MapMemory) | walk to the nearest one, face it, `gather` until it carries 5 |
| `explore` | the agent remembers no food tile, and the first step toward a random tile within 8 steps of the den core is possible | walk there, ~5 s at most |
| `bring_food_home` | the agent carries 5 food (a full load) and the den holds less than 10 | walk home, `deposit` |
| `eat_at_den` | food is 0 and the den has food | walk home, `take` food |
| `flee_to_den` | a threat is in sight and the agent is outside the den | walk home |
| `roar` | a threat is in sight | show a "ROAR!" bubble, stand still ~2 s |
| `attack:<id>` | one for each threat seen this tick | walk to it, face it, attack once per ~1 s; stop when it is no longer a threat |

A threat is an enemy within 6 steps of the den core, or an enemy next to the agent. Beasts do not hunt enemies far from the den: they guard it. Food taken at the den (3) is less than a full load, so `bring_food_home` does not store it back; without this rule, take and deposit alternate and each turn is a paid call (seen in a spike: 88 calls in 45 s, 50 after the fix).

Berry bushes east of the den are the beasts' food source. Dead NPCs come back (`server/src/simulation/respawn.ts`): a village NPC after ~30 s; a den beast after ~30 s when the den pays 5 food, or for free when no beast of the den is alive, so a den never dies out.

Rule: every offered option must give at least one frame. An option that is done at once makes the agent ask again at once. In a playtest this caused 358 calls in a short session. A test checks this rule. As a backstop, each agent asks Jev at most once per 8 ticks (~1 s); a goal that still ends at once (blocked path) costs at most that.

### State given to Jev (`describeState`)

Words, no coordinates:

```json
{
  "self": "a beast of the den. HP 30 of 100. Carrying 0 food. Hungry.",
  "home": "the den is 6 steps away and holds 20 food",
  "visible": ["player-0, an enemy player, 2 steps away, HP 100 of 100"]
}
```

Information sources:

- "Visible" comes from the agent's own MapMemory, tiles recorded this tick. This includes what an adjacent den-mate saw this tick: the memory merge copies tiles with their timestamp. That is the information model's adjacency sharing, so a beast can attack an enemy that its neighbour sees.
- Enemy HP and role, and the food count of the den, come from live server state. Note: when the beast is away from the den, it should only know the food count from its last visit. See TODO in `CLAUDE.md`.

### Turning a goal into frames (`nextFrame`)

- Movement is a greedy step along the longer axis, then the other axis, and impassable tiles are skipped. A beast behind water gets no step; its goal ends and it re-asks at most once per second. The upgrade is a breadth-first search (BFS) over passable tiles.
- Turn-before-move applies: a direction frame toward an adjacent target only turns the agent.
- A beast emits at most one direction frame (step or turn) per 2 ticks, about 4 tiles/s, so a player who holds a key can outrun it.
- `attack` waits 8 ticks between hits. Without the wait, three beasts killed a player in under 1 s. The wait is stored on the goal: when the target leaves sight, the goal ends, and a new `attack` goal can hit at once. So "about 1 attack per second" is not a strict limit.

### Failure and no key

If `TYPESAFE_API_KEY` is not set, or a call fails, the controller uses a rule, in this order: hungry and the den has food → `eat`; a threat in sight → attack it; a full load and the den is low → `store`; a known food tile and not full → `forage`; else walk to the den core and wait there (`rest` if the agent has no den). The reply from Jev is accepted only if it is one of the offered ids. Tests clear `TYPESAFE_API_KEY` in `server/vitest.config.ts`, so tests never call the real API.

### Observability

The server logs each decision: `[jev] mnpc-0 chose attack:player-0 from rest, guard_den, forage, roar, attack:player-0`.

## Removed with this change

- `LLMScheduler`, `prompt-builder`, `response-parser`, the `LLM_*` constants.
- `dialogue-gate.ts` and the dialogue `request` node. Quest acceptance can bring back a yes/no decision as a Jev `noul` question.
- The trigger system (`TriggerRegistry`, tick phase 8). It had no live use, supported only `set_fact`, and merged the beliefs of all agents into one global view.
- Production, merchants and the `trade` action. None of them worked as the MVP spec describes.

## Next steps toward the demo

- Personality: put a trait ("cowardly", "greedy", "aggressive") in the state. Then check with real runs that the trait changes the choices.
- Quests: build them on NPC events and dialogue actions. A quest offer can be a Jev `noul` question asked on behalf of the NPC.
- Villagers as Jev agents, with their own option menu.
