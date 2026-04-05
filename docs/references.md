# References

Prior art and industry resources relevant to town-zero's design decisions.

## Client-Side Movement Prediction

- [Gabriel Gambetta - Client-Side Prediction and Server Reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html) — Canonical reference. Client applies inputs immediately, tags with sequence numbers, replays unacknowledged inputs on server response. Our grid-based approach simplifies this: tile movement is atomic (no intermediate states), so `lastServerPos` change detection replaces the replay queue.
- [GameDev.net - Client Side Prediction and Server Reconciliation](https://www.gamedev.net/forums/topic/697159-client-side-prediction-and-server-reconciliation/) — Forum discussion confirming grid-based games benefit from simpler reconciliation since prediction errors are trivially detectable (position mismatch) and correctable (snap to server tile).

## Fog of War

- [Riot Games - A Story of Fog and War (League of Legends)](https://www.riotgames.com/en/news/story-fog-and-war) — 128x128 binary visibility grid with smart upscaling. Stores visibility as metadata alongside the map.
- [Didac Romero - Fog of War Tutorial](https://didacromero.github.io/Fog-of-War/) — Per-tile enum (unknown/explored/visible) approach. Black shroud for unexplored, semi-transparent dark for explored.
- [Leukino - Fog of War (RTS)](https://leukino.github.io/fog-of-war/) — Similar per-tile enum approach for RTS games.

Our `TileSnapshot` model (terrain + entities + timestamp, level derived not stored) is closer to Warcraft II's "last-seen" state but generalized — new tile properties are captured automatically without new code paths.

## Fog of War Security

- [Riot Games - Demolishing Wallhacks with VALORANT's Fog of War](https://www.riotgames.com/en/news/demolishing-wallhacks-valorants-fog-war) — Gold standard: server uses Potentially Visible Sets to never send hidden enemy positions to the client. Eliminates wallhacks at the data level.
- [Edward Thomson - Preventing Cheaters in Fog of War Games](https://edward-thomson.medium.com/preventing-cheaters-in-fog-of-war-games-69f202fbe107) — Explores cryptographic approaches for P2P games.

Our MVP sends full state but client reads from fog snapshots only. Architecture is positioned for server-side culling upgrade.

## Game Input

- [Nicky Dover - Handling Multiple Key Presses in Vanilla JS](https://medium.com/@dovern42/handling-multiple-key-presses-at-once-in-vanilla-javascript-for-game-controllers-6dcacae931b7) — keydown/keyup Set + game loop polling is the standard pattern.
- [Gablaxian - Handling User Input](https://gablaxian.com/articles/creating-a-game-with-javascript/handling-user-input/) — Tutorial demonstrating the same held-key tracking approach.
- [GameDev.net - Asynchronous Keyboard Input for Fixed-Time Step Games](https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/asynchronous-keyboard-input-for-fixed-time-step-games-r3959/) — OS key repeat is unsuitable: initial delay varies, only repeats last key, rate differs across platforms.

## Unified Input Frame Models

- [Valve Developer Community - CUserCmd](https://developer.valvesoftware.com/wiki/CUserCmd) — Source Engine sends one `CUserCmd` struct per tick containing movement vector, view angles, and button bitmask. All input is captured in a single frame; the server processes the entire struct atomically. This is the canonical FPS approach to unifying movement and actions into one per-tick message.
- [Overwatch GDC 2017 - Networking Scripted Weapons and Abilities](https://www.gdcvault.com/play/1024001/Networking-Scripted-Weapons-and-Abilities) — Overwatch's "Command Frame" model processes movement and abilities in the same simulation frame. Deterministic replay of command frames enables both client-side prediction and server reconciliation for abilities, not just movement.
- [RogueBasin - Time Systems](http://www.roguebasin.com/index.php/Articles#Time_management) — Roguelike games use unified action queues where each action (move, attack, use item) consumes one turn. No separate channels for movement vs. actions — the turn is the atomic unit. This model maps naturally to tick-based simulations where one decision per tick is the constraint.

Our `InputFrame` design draws from all three: Valve's single-struct-per-tick, Overwatch's reconciliation of abilities alongside movement, and roguelike single-action-per-turn simplicity. The key adaptation is that `InputFrame.action` takes priority over `InputFrame.direction` within the same frame, rather than processing both simultaneously (as in FPS games where you can strafe and shoot).

## Visual Design

- [Understanding Eigengrau](https://www.oreateai.com/blog/understanding-eigengrau-the-color-of-darkness/9cf9395526f2c25bca22e56ce40e3c76) — Eigengrau (`#16161D`) is the color humans perceive in total darkness due to spontaneous retinal activity. We use it for unseen tiles to distinguish from true black (`#000`) for void outside the map boundary. This specific distinction doesn't appear in game dev literature.
