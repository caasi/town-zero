# TODO

The open work for town-zero. `CLAUDE.md` has the rules for working in the code; this file has what is left to do. Read it before you start new work. Earlier done work is in `git log` and `CHANGELOG.md`.

## Known debt

Limits and shortcuts in the code that are not fixed yet.

- **Input queue overflow drops a frame without an ack (acknowledgement).** When more than `INPUT_QUEUE_CAP` (3) player frames wait on the server (a burst after network jitter, or more than one frame per tick for a while), `Agent.enqueueInput` drops the oldest one and does not advance `lastProcessedInput`. The client predicted that move, so the player is pulled back one step. Found by the fast-check property `server/test/rooms/input-ack.property.test.ts` (an `it.fails` test records it; smallest case: four moves in one tick). Fixing it is a gameplay decision: a larger cap adds input delay after a burst.

- AI movement is a greedy step (`stepToward` in `jev-controller.ts`); a beast behind water gets no step and re-asks Jev at most once per second. Upgrade to BFS (breadth-first search) over passable tiles when maps get obstacles.
- Player attacks have no cooldown (one per key press, up to 8/s). AI beasts wait ~1s between attacks, but the wait is stored on the attack goal: a new goal (target left sight and came back) can hit at once.
- Speech bubbles are drawn in the same pass as the agents (`client/src/renderer.ts`), so an agent drawn later covers a bubble (seen: a player diamond over "Greetings, traveler!"). The owner's direction: move the speech bubbles and the action hint to a UI (glass) layer above the canvas, directly under the touch controller. The hint is drawn after all agents for now.
- Tabs of one browser share the stored player name (localStorage): a second tab joins with the same name, the server gives it a number ("Quiet Otter 2"), and the client does not keep that number. Not fixed on purpose.
- After death the HUD (heads-up display) can still show the last HP (hit points) before 0 (the `death` message arrives before the state patch).
- `material` and `currency` have no use since production and merchants were removed.
- A respawned village NPC (non-player character: Farmer Reed or the innkeeper) is added back to `populationIds` without a cap check: if a player took the freed slot, the village is one over its cap until someone leaves. It also respawns on the first free territory tile, not at its post (Farmer Reed starts at (9,19), the innkeeper at (11,21)).

### Accessibility

Known gaps, accepted for now. The game draws on a canvas that a screen reader cannot read, and the keyboard path works.

- The touch D-pad (`#dpad` in `client/index.html`) gives a screen reader no direction controls. The four arrows are `aria-hidden`, and a direction comes only from where the finger is. To fix, make each direction a named button, and keep the drag for held movement.
- The action hint (Talk, Attack, Gather, Deposit) is drawn only on the canvas. The Action button is named only "Action", and the gray state (the action changes nothing) is visual only.
- The B button (Back) does nothing yet, but a screen reader announces it as a working button.
- Speech bubbles, and the name drawn over a player sprite, are only on the canvas. The list of players online (`#player-list`) is in the DOM.
- A laptop with a touch screen matches `any-pointer: coarse`. It gets the touch controller, and it loses the keyboard hints (`#key-hints`, `.dlg-hint`), also in a dialogue.
- The overlay buttons (Revive, Retry, Reload) and the name button are smaller than the touch minimum, `--touch-min` (48px) in `client/index.html`.

## Open items

Open items are in priority order: first small items for the deployed game, then the demo (random quests and NPCs with personality), then the rest.

- [ ] **Shared dialogue tree pools by village or region.** Pools of whole dialogue trees that many NPCs share, picked by personality in `reply` nodes. Draft design: `docs/superpowers/specs/005-shared-dialogue-tree-pools-design.md` (spike first).
- [ ] **Quests belong to NPCs and the ecosystem, not to players.** The game is a terrarium, not an MMORPG (massively multiplayer online role-playing game): no player-centric quests for now. A quest is either an NPC's own (Farmer Reed's food request) or shared by the situation (for example the whole village needs food), and the ecosystem decides whether it exists; whether that decision goes to Jev is open. So NPC beliefs that everyone shares are the intended model: after one player accepts Reed's quest, every player sees it as active (entry point, the "Don't forget the food!" farewell, "food quest active" in the Jev reply state). Do it with the quest system: generate quests, build them on NPC events plus dialogue actions (event handlers will need more than `bubble`), and ask for quest acceptance as a Jev `noul` question.
- [ ] **i18n (internationalization).** Dialogue text is English and is its own key (keyless i18n, `resolveLocale` in `evaluator.ts`), but no runtime path passes a locale and there is no locale file. Decide where text is translated (the server renders dialogue, so it needs each player's locale, for example on join; or the server sends the key and the client translates) and how UI text in `index.html` and `main.ts` is translated. Jev descriptions stay English.
- [ ] **Dialogue-effect damage bypasses combat events.** The `damage` callback in `server/src/dialogue/dialogue-session.ts` (called by `executor.ts`) calls `Agent.takeDamage` directly; route it through `applyDamage` so `combat:hit` / `combat:death` fire for scripted damage.
- [ ] **Dialogue eDSL (embedded domain-specific language) review:** add `DialogueTreeData.validate()` for build-time graph integrity checks (dangling refs, empty next, action cycles)
- [ ] **Discuss: open world, not separate maps.** The goal is travel between towns and a royal capital. The model's view (2026-10-07, not agreed yet): one continuous world, because distance is what makes travel, scouts and news speed matter (MapMemory, information only between adjacent agents). Make it scale with (1) interest management: send each client only what it can see; now every tile goes to every client on a 40×40 map. `@colyseus/schema` has a `StateView` class; spike it first. (2) Simulation LOD (level of detail): detailed ticks near players, abstract events far away (also the open question of NPCs living with no player online, and the Jev cost). (3) Chunks, and server sharding later if needed. Larger maps also need path finding (see the greedy `stepToward` under Known debt above).
- [ ] **RPG (role-playing game) look for players and NPCs.** Agents are drawn as plain shapes now (`client/src/renderer.ts`). Give PCs and NPCs an RPG look: sprites by role and faction, facing direction, and states such as dead, talking and roaring.
- [ ] **Downed NPCs instead of removal.** Until then, `processRespawns` brings dead NPCs back after ~30s (a temporary measure). When a town NPC is killed, do not remove it: it stays down, and a player or another NPC can carry it back to town and heal it there. The same must work for enemy NPCs that are not beasts. Beasts keep the current death.
- [ ] **Tile object / prop system:** Tiles need an `objectType` layer separate from terrain (bush, box, tree). Currently bush uses a minimal `objectType` field on Tile; future iteration should extract a full TileObject concept with durability, loot tables, and interaction types. Settlement structures remain separate from wild tile objects.

## Unranked

No priority given yet; rank them before they move up.

- [ ] **Hunting: humanoids kill beasts for food.** This brings competition and balance. It adds a second food source and a feedback loop: beasts live on berries, people live on berries and on beasts, and heavy hunting costs the den food for respawns, so fewer beasts are left. It is also a source of situational quests ("too many beasts", "the berries are gone"). Two steps: (1) players as hunters: a dead beast leaves food that can be gathered, a limited amount that does not grow back (reuse the resource amount on tiles); no new role. (2) NPC hunters later: village NPCs are not driven by Jev now, so this needs an option list for humanoid NPCs (hunt, bring meat home, flee); it is related to downed NPCs and the quest system. **Fix the respawn rule first:** a den with no live beast respawns one free, so once players can hunt, killing all beasts would give free food every ~30s. Choosing the new rule (no respawn without food, so the den dies out; or a longer wait) is a gameplay decision.
- [ ] **Game settings in the deploy settings.** At some point, the hard-coded settings (for example in `shared/src/constants.ts`, and the constants at the top of modules such as `jev-controller.ts`) should be part of the deploy settings.
- [ ] **Communication as an action.** Now `mergeAdjacentMemories` copies the whole MapMemory and all beliefs between adjacent agents of the same faction each tick: no agent chooses to tell, it cannot pick what to tell or lie, and it costs nothing. Make telling an action instead, for example a beast howl that Jev can choose, with a cost (an action, the position is heard) and a range, and with a choice of what to tell ("food is here", "enemy"). A player must also be able to tell villagers what it knows. Players are in the village faction, so today their memory merges with villagers automatically too. This affects the quest design and the villager dialogue, so decide it with them.
- [ ] **Observers.** When the room is full, a joining user becomes an observer: it can see the whole map, but it has no PC (player character) and cannot interact. A player can also turn its PC into an observer.

## Done

- [x] Player names: a random adjective-and-animal name on a first visit, rename from the HUD, names and colors of other players, a list of players online
- [x] Personality for friendly NPCs: replies picked by Jev from personality and state (spec 004). Beasts have no personality yet.
- [x] AI NPC decisions with Jev for den beasts (spec 003)
- [x] Player revive in the village after death
- [x] Add NPC dialogue system (session manager, Farmer Reed scenario, GameRoom integration, client UI)
