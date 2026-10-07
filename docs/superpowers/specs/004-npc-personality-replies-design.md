# 004 — NPC personality and replies picked by Jev

Status: agreed design, not implemented. The spike code decides the details;
update this file when the code differs.

## Goal

Friendly NPCs feel alive: the same player line gets a different reply from
NPCs with a different personality. Code lists pre-written replies, Jev picks
one, code shows it (the rule of spec 003). No model writes dialogue text.

If the personality does not change the pick, a random choice does the same,
and Jev is not needed. So the check for this feature is that the personality
changes the pick.

## Evidence (spike, 2026-10-07)

One node (Farmer Reed is asked "What's in it for me?"), four replies, five
personalities, four Jev calls each:

Percentages are Jev's probability for the picked reply in the first run.

- grumpy → dismissive 4/4 (100%), suspicious → distrust 4/4 (99%),
  dutiful → common good 4/4 (98%).
- No personality → a near tie (common good 47%, offer a reward 45%), and the
  pick changes between runs.
- generous → common good (70–72%), not "offer a reward", with either option
  order. So the wording of the personality and of the reply descriptions
  decides the pick, not the option order. Check new wording with real calls.

## Design

**NPC profile.** `NpcDefinition` gets two required fields:

```ts
type Gender =
  | { kind: "male" }
  | { kind: "female" }
  | { kind: "nonbinary" }
  | { kind: "other"; description: string };

gender: Gender;       // story data: no simulation rule reads it; the Jev state does
personality: string;  // one English sentence for Jev
```

The scenarios use only `male` and `female` now (a medieval setting with
traditional gender roles). `nonbinary` and `other` are in the type because the
world allows them; whether a story uses them is a story decision, not a system
change.

`describeGender` turns a gender into words for Jev with an exhaustive
`switch`. Players have no gender yet.

**`reply` node.** A list of lines. Each line has an id, a description for Jev,
the text the player sees (a `TextTemplate`, the same type as a text node, so a
later locale pass covers both; no runtime path passes a locale today), an
optional `condition` and a `next` node. Code drops the lines whose condition
is false. The neutral line comes first; it is the fallback, and its type has
no `condition`, so at least one line always stays (the rule of spec 003: every
offered option yields a result; it also puts Jev's first-option bias on the
neutral line). When only one line stays, it shows without a Jev call.

**Who calls Jev.** `GameRoom` owns the chooser (as for the beasts). The
session only records "at a reply node, not asked" and later the picked line
id. Each tick `GameRoom` scans the active sessions: it asks Jev for a session
that waits, and when a session has an answer it moves the session to that line
and sends the payload, as `tickDialogues` does. No call starts inside
`getState()`, which runs twice per message. One call in flight per session. A
separate abstraction for this can come later.

**Async flow.** On a `reply` node the session sends a waiting
state; the client shows "…" and ignores E, W and S (Esc still closes the
dialogue). While it waits, `dialogue:advance` and `dialogue:choose` return
`ok` and send the same waiting payload again; an error would make the client
leave the dialogue while the server keeps the input lock. With this no-op,
the cost is at most one call per reply node per visit. A failed call or
the Jev call timeout (`TIMEOUT_MS`, 5 s in `jev.ts`) picks the first line.
Without a key the first line shows at once, with no waiting state. The
dialogue timeout (`DIALOGUE_TIMEOUT_TICKS`) cannot end a session while it
waits, because the message that reached the node resets it. An answer that
arrives after the session ended (Esc, the player left or died, the NPC died)
is dropped: tie the pending answer to the session object, not to the NPC id,
because the same NPC can start a new session within 5 s. Test this and the
in-flight rule with `fc.scheduler`, as in `jev-timing.property.test.ts`. Log:
`[jev] <npc id> replied <line id> from <line ids> (in N, out N)`; the token
counts show only when the reply has usage.

**Farewell on timeout.** When a dialogue ends by the dialogue timeout, the
NPC says a farewell in its speech bubble. Each NPC has its own written
farewell lines (its personality is in the wording), with optional
conditions (for example "Don't forget the food!" while the quest is active).
No Jev call: the only context is the fixed personality, and with a strong
personality Jev picks the same line every time. Use Jev here when the
farewell must depend on several changing facts (for example after event
memory exists).

**Jev state, in words.** NPC name, gender, personality, the dialogue beliefs
that matter (for example the quest is active), what the player just said, the
village state (for example food is low). The session has no settlement today
(`buildEvalContext` sets `settlement: null`), so the village state is new
wiring. A villager is at home, so reading the live village state is right
here (unlike the beasts' known debt). No coordinates. Event memory comes
later.

**Demo NPCs.** Farmer Reed (male, dutiful) keeps his quest and gets a `reply`
node. A new village NPC (female, grumpy) talks but gives no quest.

## Checks

- Unit tests: waiting state, fallback, late answer, condition filter.
- Real Jev runs, as in the spike: the same player line to both NPCs gives
  different replies. Also check whether gender changes the pick.

## For the spike

- Scenario NPCs are `controller: "bot"`; `JevController` drives only `"llm"`
  agents, so the reply path is new wiring, not an extension of the beasts'.
- The second village NPC must join `village.populationIds` by hand, as
  Farmer Reed does (`generator.ts`), and takes one player slot. It needs a
  dialogue entry (`d.entry(..., literal(true))`) even without a quest, or
  `dispatchInteract` treats it as a same-faction agent with no entry (noop).
- `s.npc()` has 23 call sites (the scenario and five test files) that need
  the two new fields.

## Decided

- The background story is in `docs/story.md`.
- Dialogue text is written in English; it is the i18n key, and the player's
  line in the Jev state is English too.

## Not in scope

Player gender, beast personality, event memory, a locale file.
