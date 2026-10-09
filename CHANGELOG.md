# Changelog

All notable changes to town-zero. Each push to `main` is deployed, so the
entries are grouped by date, not by version. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-10-10

### Added

- You can play on a touch screen. A D-pad moves you, and the **A** button
  does what **E** does. The controller is hidden in a dialogue. On iPhone
  Safari, the "Hide Toolbar" option gives more space.
- A word beside your character tells what **E** or **A** will do
  now: Talk, Attack, Gather or Deposit. It is gray when the action changes
  nothing, for example a deposit with empty hands.
- In a dialogue, you can click or tap the text to continue, tap an option
  to choose it, and tap **✕** to close.

### Changed

- **E** deposits. Stand on a housing cell (**H**) of any village or den,
  with nothing to do in front of you, and press **E** to store all you
  carry there. The **T** key is gone.

### Removed

- The page no longer asks for full screen when you touch the controller.
  On Android it asked again at the next touch after each exit.

## 2026-10-07

### Changed

- You are drawn in the color of your name, the same color the other
  players see you in. You are a diamond in your color, and the other players
  are white diamonds edged in their color. The player list shows each
  color.
  Your name at the top left has that color too.
- You cannot take the name of another player or of an NPC, also with
  other capital letters. A second tab of the same browser gets a number
  after the name, such as "Quiet Otter 2".
- Food places run out. A berry bush or a food tile holds 3 food, and each
  one grows back 1 food every 30 seconds. An empty one shows no food.
  Material tiles work the same way.
- When the berries a beast knows are all gone, it can wait near them until
  they grow back, instead of walking around to look for food.
- A beast that brings food home keeps 3 food for itself and stores the
  rest. Before this change, it stored all of it and then took food back at
  once.
- Beasts know only what they saw. A beast away from the den knows the den
  food from its last visit, or from a den-mate that it met. It sees an
  enemy's HP at the moment it looks.

- The village holds 12 people (was 8): Farmer Reed, the innkeeper and 10
  players.

- The server log shows the token count of each AI decision, for example
  `[jev] mnpc-0 chose rest from rest, guard_den (in 424, out 41)`.
- Beasts stop making AI decisions while no player is active. A player is
  active while the browser tab is visible and the player did something in
  the last 2 minutes. Before this change, one tab left open overnight kept
  the AI decisions running for 9 hours. Paused beasts do not get hungry.
- Beasts take one step every 2 ticks, so players can outrun them.

### Added

- Name your player. On your first visit the game picks a name for you,
  such as "Quiet Otter"; select your name at the top left to change it.
  The browser remembers it.
- Other players are drawn in their own color, with their name above
  them, and a list of the players online is at the top right.

- The innkeeper of Tandi, a grumpy woman who talks but gives no quest.
- Friendly NPCs answer some questions with a reply that fits their
  personality and the village's food, picked by the AI from written lines.
  Farmer Reed and the innkeeper answer the same kind of question
  differently.
- An NPC says goodbye when you stand in a dialogue too long.
- After an update, `Retry` on the error screen loads the new version of
  the game. If a page still runs another version than the server, it
  shows a notice with a `Reload` button.
- Beasts guard their den, collect berries from bushes, bring full loads
  home and roar at intruders. They attack only enemies near the den or
  next to them.
- Dead NPCs come back: village NPCs after about 30 seconds, beasts when
  their den pays food (free when no beast of the den is alive).
- The HUD shows the build commit, so a bug report can name the build.
- Property tests (fast-check) for input timing and AI decision timing.
- `pnpm run typecheck` checks the test files and the client code too.

### Fixed

- When the village is full, the error screen says so ("The village is
  full. Try again later.") instead of "Connection failed: Village is
  full".
- The dialogue panel showed "npc" as the speaker; it shows the NPC's
  name now.
- Walking into the map edge moved the player one tile off the map and then
  back. The client now knows the map size and does not predict that move.
- Players were pulled back one tile when they released a movement key.
- The client shows the error screen at once when the server closes the
  room, instead of freezing while it tries to reconnect.
- The server no longer sends unchanged settlement structures in every
  update (222 bytes to 2 bytes per idle tick).

## 2026-10-06

### Added

- AI NPC decisions with Jev (TypeSafe AI): code lists the options, Jev
  picks one, and code acts on it. The first AI NPCs are the den beasts.
- Players can revive in the village about 5 seconds after death, with
  their inventory and their map memory.
- Production deployment: a container image, CI that publishes it, and an
  update job on the server that pulls each new image.

### Changed

- A player who leaves is removed from the world, and a new join creates a
  new player.

### Removed

- Systems that had no working use: the free-form LLM path, triggers,
  production, merchants and trade, dialogue request nodes, and the chat
  room.

## 2026-04 (MVP)

### Added

- Multiplayer world on Colyseus with villages, a monster den, fog of war
  and a map memory for each agent.
- Canvas 2D client with movement prediction, layout-independent keys and
  key hints for the detected keyboard layout.
- One input model for players, bots and AI NPCs (`InputFrame`), with
  server reconciliation of client input.
- Facing direction, bush tiles, and multi-tile settlements.
- NPC dialogue trees (Farmer Reed) with beliefs and conditional entry
  points.
- Combat as an interaction on the faced tile, NPC speech bubbles, and a
  typed NPC event system.
