# town-zero

A multiplayer real-time ecosystem simulation .io game with AI-driven NPCs. Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction = defeat; cooperation is possible but betrayal is allowed.

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
pnpm run test
```

## Current State

**Working:**
- The server simulation runs in a Colyseus `GameRoom` at 8 ticks per second. It syncs state to the clients and sends vision updates, death messages and NPC dialogue.
- The Canvas 2D client draws the world with fog of war, movement prediction, a HUD and a dialogue panel. The HUD shows the build commit in the bottom-right corner, so you can name the build in a bug report.
- Den beasts are AI NPCs. Code makes a short list of options, the Jev model (TypeSafe AI) picks one, and code does it. Beasts guard their den, gather food at berry bushes, store it in the den, roar at intruders and attack threats.
- A dead player can revive in the village after about 5 seconds. A dead NPC comes back on its own after about 30 seconds.
- A Docker image is built for each push to `main` (see `deploy/README.md`).

**Next:** NPC personality and generated quests (see the TODO list in `CLAUDE.md`).

## Controls

- **WASD** or **arrow keys**: move. The first press in a new direction only turns you.
- **E**: interact with the tile in front of you. You talk to an NPC, attack an enemy, or gather from a resource tile.
- **T**: deposit what you carry at your settlement.
- In a dialogue: **W/S** to select, **E** to confirm, **Esc** to close.

The keys use physical positions, so they work on any keyboard layout.

## How It Works

Players join a 40x40 grid world with a **village** and a **monster den**. Both are settlements with population, inventory, structures and territory.

- **Players** send one input frame per tick. A player who leaves is removed from the world. The room closes when the last player leaves, and the next player gets a new world.
- **AI NPCs** (the den beasts) use the Jev model through `server/src/ai/jev-controller.ts`. Without `TYPESAFE_API_KEY`, or when a call fails, a fixed rule decides. With no player in the room, no Jev calls are made.
- **Food:** every agent eats one food from its own inventory about every 30 seconds. Players take food from the village store. Beasts gather it at the berry bushes near the den.
- **Fog of war:** each agent sees only a Manhattan-distance radius and remembers what it saw. Agents of the same faction share memory only when they stand next to each other.

### Simulation Loop (8 ticks/s = 125 ms)

Source of truth: `processTick` in `server/src/simulation/tick.ts`.

0. Before the tick, `GameRoom` asks the Jev controller for one frame for each AI NPC.
1. Run one input frame for each living agent (direction: turn, then move; action: instant effect).
2. The bot controller plans for idle bot agents.
3. Agents eat food (a starving player loses HP).
4. Vision update, speech bubbles and NPC events.
5. Memory merge between adjacent agents of the same faction.

After the tick, `GameRoom` brings back NPCs that have been dead long enough.

### Run with the Jev model

```bash
export TYPESAFE_API_KEY=...   # your TypeSafe AI key
pnpm run dev:server
```

Each decision is logged as `[jev] <agent> chose <option> from <options>`. Tests never call the real API.

## Tech Stack

- **Monorepo:** pnpm workspaces (`shared/`, `server/`, `client/`)
- **Server:** Colyseus 0.17 (`@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` v4), Node.js via tsx
- **Client:** Canvas 2D renderer + `@colyseus/sdk` + Vite
- **AI NPCs:** Jev model (TypeSafe AI), choice questions only
- **Testing:** Vitest
- **Language:** TypeScript (strict, ES2022)

## Project Structure

```
shared/          # Types, constants, InputFrame, script DSL for NPCs and dialogue
server/
  src/
    simulation/  # Grid, Agent, Settlement, executeFrame, vision, events, respawn, tick
    ai/          # Jev client, Jev controller (beasts), bot controller
    dialogue/    # Dialogue engine, sessions, expression evaluator, effects
    scenarios/   # NPC scenarios (Farmer Reed)
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
deploy/          # Docker Compose, nginx and update script for a server
docs/            # Specs, plans and references
```

## License

See [LICENSE](LICENSE).
