# town-zero

A multiplayer real-time ecosystem simulation .io game with AI-driven NPCs (non-player characters). Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction is defeat; cooperation is possible but betrayal is allowed.

## Getting Started

### Prerequisites

- Node.js 22+
- [pnpm](https://pnpm.io/) 10+

### Install

```bash
pnpm install
```

### Run

```bash
# Start the server (builds shared types automatically, port 2567)
pnpm run dev:server

# In another terminal, start the client (port 3000)
pnpm run dev:client
```

Open `http://localhost:3000` in your browser.

### Build

```bash
pnpm run build
```

### Test

```bash
pnpm run test        # server and client tests (not the property tests)
pnpm run test:props  # the fast-check property tests (*.property.test.ts)
pnpm run typecheck   # types of src and test files; run pnpm run build first
```

CI runs all three.

## Current State

**Working:**
- The server simulation runs in a Colyseus `GameRoom` at 8 ticks per second. It syncs state to the clients and sends vision updates, death messages and NPC dialogue.
- The Canvas 2D client draws the world with fog of war, movement prediction, a HUD (heads-up display) and a dialogue panel. The HUD shows the build commit in the bottom-right corner, so you can name the build in a bug report.
- Den beasts are AI NPCs. Code makes a short list of options, the Jev model (TypeSafe AI) picks one, and code does it. Beasts guard their den, gather food at berry bushes, store it in the den, roar at intruders and attack threats. Food places run out and grow back slowly.
- Each player has a name: a random adjective and animal on a first visit; select your name at the top left to change it. No two players or NPCs can have the same name. Players are drawn in the color of their name, and the players online are listed at the top right.
- A dead player can revive in the village after about 5 seconds. A dead village NPC comes back on its own after about 30 seconds; a dead beast comes back after about 30 seconds when the den has food to pay for it; when no beast of the den is alive, the first one comes back free.
- A Docker image is built for each push to `main` (see `deploy/README.md`).

**Next:** shared dialogue pools and generated quests (see `TODO.md`). Changes by date are in `CHANGELOG.md`.

## Controls

- **WASD** or **arrow keys**: move. The first press in a new direction only turns you.
- **E**: interact with the tile in front of you. You talk to an NPC, attack an enemy, or gather from a resource tile.
- **T**: deposit what you carry at the settlement you stand in.
- In a dialogue: **W/S** to select, **E** or **Enter** to confirm, **Esc** to close.

The keys use physical positions, so they work on any keyboard layout.

## How It Works

Players join a 40x40 grid world with a **village** and a **monster den**. Both are settlements with population, inventory, structures and territory.

- **Players** send one input frame per tick. A player who leaves is removed from the world. The room closes when the last player leaves, and the next player starts in a new world.
- **AI NPCs** (the den beasts) use the Jev model through `server/src/ai/jev-controller.ts`. Without `TYPESAFE_API_KEY`, or when a call fails, a fixed rule decides. With no active player (a visible tab that sent a key press or a message in the last 2 minutes), no Jev calls are made.
- **Food:** every agent eats one food from its own inventory about every 30 seconds. A player without food loses HP. Players gather food at the bushes east of the village (face a bush and press E). Beasts gather it at the berry bushes near the den.
- **Fog of war:** each agent sees only a Manhattan-distance radius and remembers what it saw. Agents of the same faction share memory only when they stand next to each other.

### Simulation Loop (8 ticks/s = 125 ms)

Source of truth: `processTick` in `server/src/simulation/tick.ts`.

0. Before the tick, `GameRoom` asks the Jev controller for one frame for each AI NPC.
1. Run one input frame for each living agent (direction: turn, then move; action: instant effect).
2. The bot controller plans for idle bot agents.
3. Agents eat food (a starving player loses HP), and resource tiles grow back.
4. Vision update, speech bubbles and NPC events.
5. Memory merge between adjacent agents of the same faction.

After the tick, `GameRoom` brings back NPCs that have been dead long enough.

### Run with the Jev model

```bash
export TYPESAFE_API_KEY=...   # your TypeSafe AI key
pnpm run dev:server
```

Each decision is logged as `[jev] <agent> chose <option> from <options> (in <tokens>, out <tokens>) at (<x>,<y>), carrying <food>, den food <count>`. Tests never call the real API.

## Tech Stack

- **Monorepo:** pnpm workspaces (`shared/`, `server/`, `client/`)
- **Server:** Colyseus 0.17 (`@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` v4), Node.js via tsx
- **Client:** Canvas 2D renderer + `@colyseus/sdk` + Vite
- **AI NPCs:** Jev model (TypeSafe AI), choice questions only
- **Testing:** Vitest
- **Language:** TypeScript (strict, ES2022)

## Project Structure

```
shared/          # Types, constants, InputFrame, script DSL for NPCs and dialogue, player name rules
server/
  src/
    simulation/  # Grid, Agent, Settlement, executeFrame, vision, events, respawn, tick
    ai/          # Jev client, Jev controller (beasts), bot controller
    dialogue/    # Dialogue engine, sessions, expression evaluator, effects
    scenarios/   # NPC scenarios (Farmer Reed, the innkeeper)
    map/         # Map generator and settlement templates
    rooms/       # Colyseus GameRoom, schemas, sync, validation, vision
    http/        # Static file server for the built client (production)
client/
  src/
    main.ts         # Game loop, HUD, overlays, connection management
    network.ts      # Colyseus connection with join timeout
    renderer.ts     # Canvas 2D renderer (terrain, entities, bubbles, fog)
    camera.ts       # Player-centered viewport
    fog.ts          # Fog of war from tile snapshots
    input.ts        # Movement and action keys, per-tick input frames
    display.ts      # Movement prediction, server reconciliation, smooth rendering
    dialogue-ui.ts  # Dialogue panel
    player-name.ts  # Your name in localStorage, the rename hint
    leave-message.ts # Text of the error screen for a refused join or a disconnect
    version.ts      # Checks that the client and the server run the same build
deploy/          # Docker Compose, nginx and update script for a server
docs/            # Specs, plans, references, and story.md (the story the NPC lines draw from)
CHANGELOG.md     # Changes that players or contributors can see, by date
```

## License

See [LICENSE](LICENSE).
