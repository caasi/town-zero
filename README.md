# town-zero

A multiplayer real-time ecosystem simulation .io game with LLM-driven NPCs. Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction = defeat; cooperation is possible but betrayal is allowed.

## Getting Started

### Prerequisites

- Node.js 20+
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

## How It Works

Players join a 40x40 grid world containing a **village** and a **monster den**. Each is a settlement with population, inventory, structures, and territory.

- **NPCs** are driven by LLM calls (natural language prompt in, structured JSON commands out) or fall back to a simple rule-based bot controller.
- **Players** send commands by clicking the map. Disconnected players are seamlessly taken over by bots until they reconnect.
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
- **Server:** Colyseus 0.17 + Express
- **Client:** Colyseus SDK + Canvas 2D + Vite
- **Testing:** Vitest
- **Language:** TypeScript (strict, ES2022)

## Project Structure

```
shared/          # Types, constants, shared between server and client
server/
  src/
    simulation/  # Grid, Agent, Settlement, Commands, Resources, Combat, Vision, Tick
    ai/          # LLM prompt builder, response parser, scheduler, bot controller
    dialogue/    # Dialogue tree engine, LLM gate, tree data
    map/         # Map generator
    schema/      # Colyseus state schemas
    rooms/       # Colyseus GameRoom
client/
  src/           # Canvas 2D renderer, input handler, fog of war, HUD
```

## License

See [LICENSE](LICENSE).
