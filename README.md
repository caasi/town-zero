# town-zero

A multiplayer real-time ecosystem simulation .io game with LLM-driven NPCs. Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction = defeat; cooperation is possible but betrayal is allowed.

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

**Working:** Full game loop running. Server simulation (186 tests) is wired into Colyseus GameRoom with state sync, player commands, vision updates, and death notifications. Canvas 2D client renders the world with fog of war, HUD, trade modal, and reconnection handling.

**Next:** Wire LLM scheduler into GameRoom tick for NPC decision-making.

## Controls

- **WASD** -- Move
- **Q** -- Attack nearest enemy
- **E** -- Interact (talk to NPC / trade with merchant)
- **G** -- Gather resource at current tile
- **T** -- Deposit resources at settlement

## How It Works

Players join a 40x40 grid world containing a **village** and a **monster den**. Each is a settlement with population, inventory, structures, and territory.

- **NPCs** are driven by LLM calls (natural language prompt in, structured JSON commands out) or fall back to a simple rule-based bot controller.
- **Players** send commands via keyboard. Disconnected players are seamlessly taken over by bots until they reconnect.
- **Agents** gather resources, deposit them at settlements, operate production facilities, trade with merchants, and fight enemies.
- **Fog of war** limits each agent's vision to a Manhattan-distance radius. Agents must be adjacent to share map memory with allies.

### Simulation Loop (1 tick/s)

1. Process ongoing multi-tick actions (gathering, fighting)
2. Dequeue and execute next command from each agent's plan
3. Bot controller decides for idle bot agents
4. Production facilities convert raw materials to food
5. Agents consume food (starvation causes HP loss and death)
6. Merchant spawning and movement
7. Vision update (per-agent MapMemory)
8. Memory merge between adjacent same-faction agents

## Tech Stack

- **Monorepo:** pnpm workspaces (`shared/`, `server/`, `client/`)
- **Server:** Colyseus 0.17 (`@colyseus/core` + `@colyseus/ws-transport` + `@colyseus/schema` v4)
- **Client:** Canvas 2D renderer + @colyseus/sdk + Vite
- **Testing:** Vitest (186 tests)
- **Language:** TypeScript (strict, ES2022)

## Project Structure

```
shared/          # Types, constants, ActionCommand definitions
server/
  src/
    simulation/  # Grid, Agent, Settlement, Commands, Resources, Combat, Vision, Tick
    ai/          # LLM prompt builder, response parser, scheduler, bot controller
    dialogue/    # Dialogue tree engine, LLM gate, tree data
    map/         # Map generator
    rooms/       # Colyseus GameRoom, schemas, sync, validation, vision
client/
  src/
    main.ts      # Game loop, HUD, overlays, connection management
    network.ts   # Colyseus connection with timeout and reconnect handling
    renderer.ts  # Canvas 2D renderer (terrain, entities, fog overlay)
    camera.ts    # Player-centered viewport with edge clamping
    fog.ts       # Three-tier fog of war (visible / explored / unknown)
    input.ts     # WASD movement + action keys (Q/E/G/T)
    types.ts     # Client-side type definitions
docs/            # Design spec and implementation plan
```

## License

See [LICENSE](LICENSE).
