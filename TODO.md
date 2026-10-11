# TODO

The open work for town-zero. `CLAUDE.md` has the rules for working in the code; this file has what is left to do. Read it before you start new work. Earlier done work is in `git log` and `CHANGELOG.md`.

## Known debt

Limits and shortcuts in the code that are not fixed yet.

- **Input queue overflow drops a frame without an ack (acknowledgement).** When more than `INPUT_QUEUE_CAP` (3) player frames wait on the server (a burst after network jitter, or more than one frame per tick for a while), `Agent.enqueueInput` drops the oldest one and does not advance `lastProcessedInput`. The client predicted that move, so the player is pulled back one step. Found by the fast-check property `server/test/rooms/input-ack.property.test.ts` (an `it.fails` test records it; smallest case: four moves in one tick). Fixing it is a gameplay decision: a larger cap adds input delay after a burst.

- AI movement is a greedy step (`stepToward` in `jev-controller.ts`); a beast behind water gets no step and re-asks Jev at most once per second. Upgrade to BFS (breadth-first search) over passable tiles when maps get obstacles.
- The cache of NPC reply picks (`ReplyController`) holds `CACHE_SIZE` (1000) picks and removes the oldest one when it is full. If cache hits matter, change it to an LRU (least recently used) cache.
- Two player names count as the same name when `playerNameKey` gives the same key. The key does not cover letters of other scripts that look the same (Cyrillic "і" and Latin "i"), or full case folding ("Straße" and "STRASSE").
- Settlements are never removed from the synced state (`syncToSchema` in `server/src/rooms/sync.ts`), because no rule destroys a settlement yet. When one can be destroyed, remove it from the state as the agent removal does.
- `GameRoom` keeps a no-op `input:stop` handler only for tabs opened before the deploy that stopped sending it. Remove the handler when no such tab is left.
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
- In a dialogue, Tab and Enter cannot press the close button or an option: dialogue mode cancels every key (`handleKey` in `client/src/input.ts`), and the keyboard path is W/S, E and Esc.
- Speech bubbles, and the name drawn over a player sprite, are only on the canvas. The list of players online (`#player-list`) is in the DOM.
- A laptop with a touch screen matches `any-pointer: coarse`. It gets the touch controller, and it loses the keyboard hints (`#key-hints`, `.dlg-hint`), also in a dialogue.
- The overlay buttons (Revive, Retry, Reload) and the name button are smaller than the touch minimum, `--touch-min` (48px) in `client/index.html`.

## Rules that were comments

Facts that were in code comments before the no-comments experiment (see `CLAUDE.md`, "Comments"). No test or document held them, so a later change can break them without a failing check. Move each one into the code (a name, a type, a test) or into `CLAUDE.md`, then remove it here. The old text is in `git log -p`.

- **Client, no tests** (`client/src/input.ts`, `main.ts`, `renderer.ts`):
  - `InputHandler.update` pushes each move frame also when `predictMove` rejects it. The server can accept a move that the client refuses, and a gap in the buffer breaks reconciliation.
  - When the name field gets focus, the held keys are cleared. When the talk frame has run, the pending frames are dropped, so the player is not drawn moving.
  - The game loop syncs display positions from the server before it reads input.
  - The network handlers are registered once, because the network client lives across reconnects.
  - A new rename refusal shows for its full time: an older timer must not hide it.
  - After a revive, `displayState.clear()` in `client/src/main.ts` also drops the local player and the tile source, so prediction needs both set again.
  - Fog and culling use the integer tile position (`displayX/Y`), not the lerped pixel position, to prevent flicker in the middle of a lerp.
- **Links between modules:**
  - A beast cannot die and come back before its Jev reply, because a respawn takes ~30 s and a Jev call times out after 5 s. `server/test/ai/jev-timing.property.test.ts` does not test that case.
  - Player name colors avoid the green of friendly NPCs, the red of enemies and the blue of water in `client/src/renderer.ts`.
  - `syncSettlement` compares only structure ids, because a structure is never changed after `addStructure`.
  - `AgentSchema.talkable` is set once, because a dialogue tree never changes.
- **Game balance:**
  - The den has 4 berry bushes and 3 beasts that eat 1 food per ~30 s. So 4 food per 30 s only feeds them, and gathering by players makes the den short.
  - Each village NPC takes a population slot: 2 housing x 6 = 12 slots, so 10 players.
- **Contracts:**
  - `DialogueEngine.advance()` does not run the effects of an action node. `advanceWithEffects()` runs them.
  - An effect handler in `server/src/dialogue/executor.ts` returns `false` to stop the effects that come after it.
  - `buildOptions` calls `nextFrame` to test each option. So `nextFrame` gets a copy of the goal (it starts the attack cooldown on the goal it gets), and the goal deadlines are set when the Jev reply arrives, not in `nextFrame`.
  - On a dialogue timeout, the farewell line is read before the session ends and set after it, so a `talk:end` handler cannot hide it.
  - `FogManager.tileSource()` returns a live view. Keep one reference, set at connect time.
  - The type tests in `shared/type-tests/` import only from `shared/src/script-dsl`.

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
