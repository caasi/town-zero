# 005 — Shared dialogue tree pools by village or region (draft)

Status: draft design, not agreed yet. It was a TODO item in `CLAUDE.md`; it moved here so that it can be reviewed as a design, and so that agents do not load it every session. Spike first.

Pools of whole dialogue trees (subtrees with several levels, for example news → the monsters → where the den is), not single lines, so that common conversations can go deep. Many NPCs share a pool; the `reply` nodes inside pick by each NPC's personality, so one tree gives different NPCs different conversations (the spec 004 runs with swapped personalities show this). An NPC's own tree links into the pool trees for its village or region. Conditions read the NPC's beliefs, so what an NPC can talk about follows what news has reached it (the information model).

Limits to check with real runs: 4 to 6 lines per reply call after the conditions; each topic needs lines for each kind of personality, and a pair per personality for state to matter. Composing a pool with an NPC's own lines works at the data level (`ReplyLines` is the fallback line plus any lines), but not in the eDSL yet: `d.line()` builders belong to one dialogue builder. It needs a free `line()` that returns plain data, and a pool reference in `d.reply` that the loader expands (unique ids, the NPC's own neutral line first).

Proposed shape (spike first): lines as values (`line()` returns immutable data; `reply(id, first: Line<"plain">, ...rest)` makes a conditional first line a type error, not a runtime throw); shared trees as subtrees with declared exits (`subtree(id, { exits: ["back"] }, ...)`, `d.mount("monsters", tree, { back: "menu" })`): a subtree can `goto` only its own nodes and leave through an exit, the loader prefixes its node ids, and an unbound exit fails the build.

**Test the eDSL on its own:** the builders and the composition are data in, data out, so test every rule (unique ids, bound exits, prefixes, the first-line type) in `shared` with its own vitest, with no server, room or Jev; today the eDSL tests live in `server/test/script-dsl/` and `shared` has only type tests.

**No lazy evaluation in dialogue trees:** a subtree is a pure function applied once at build time (prefix the ids, bind the exits; capture-avoiding substitution), and the result is a closed graph of plain data, so the whole structure can always be checked before it runs and still round-trips through JSON. What changes at runtime is only the choice: conditions filter, Jev picks.
