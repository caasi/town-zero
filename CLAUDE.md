# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

town-zero is a multiplayer real-time ecosystem simulation .io game with LLM-driven NPCs. Players coexist with autonomous NPC villagers and monsters in a persistent world. Village destruction = defeat; cooperation possible but betrayal allowed. The long-term goal is to use this as a testbed for civilian C4ISR systems.

## Tech Stack

- **Monorepo:** npm workspaces (`shared/`, `server/`, `client/`)
- **Server:** Colyseus 0.17.x + @colyseus/schema 2.x + Express
- **Client:** @colyseus/sdk + Canvas 2D + Vite
- **Testing:** Vitest
- **Language:** TypeScript (strict, ES2022, experimental decorators for Colyseus schemas)

## Commands

```bash
# Install all workspace dependencies
npm install

# Run server (dev mode with hot reload)
npm run dev --workspace=server

# Run client (Vite dev server on port 3000)
npm run dev --workspace=client

# Run server tests
npm test --workspace=server

# Run tests in watch mode
npm run test:watch --workspace=server

# Build shared types (must run before server/client if types changed)
npm run build --workspace=shared

# Build all workspaces
npm run build --workspaces
```

## Architecture

**Settlement-centric model:** Villages and monster dens are the same `Settlement` abstraction with different parameters. Both have population, inventory, structures (housing + production), and territory.

**Unified ActionCommand:** All entities (players, LLM-driven NPCs, bots) produce the same `ActionCommand` type. The simulation loop does not distinguish command sources. This enables seamless player disconnect → bot takeover → reconnect.

**Simulation flow (per tick at 1 tick/s):**
1. Process ongoing multi-tick actions (gathering, fighting)
2. Dequeue and execute next command from each agent's plan
3. Bot controller decides for idle bot agents
4. Production facilities convert raw materials → food/material
5. Agents consume food from personal inventory (starvation → HP loss → death)
6. Merchant spawning and movement
7. Vision update (MapMemory per agent)
8. Memory merge between adjacent same-faction agents

**Information model:** No global omniscience. Each agent has a personal `MapMemory` (sparse grid of observed tiles with timestamps). Agents must be adjacent to exchange information. This creates natural fog of war and makes scouts strategically important.

**LLM integration:** Natural language prompt in (agent state + MapMemory) → structured JSON ActionCommand array out. Haiku-tier model, 10-30s intervals, skipped when agent is busy. Dialogue system uses pre-written RPG-style trees; LLM only decides y/n on player requests.

## Key Design Documents

- **Spec:** `docs/superpowers/specs/2026-04-01-town-zero-mvp-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-01-town-zero-mvp.md` (19 tasks, TDD, full code)

## Development Notes

- Colyseus schemas use v2 `@type()` decorator syntax (not v3)
- Server simulation is authoritative; client only renders and sends commands
- MVP fog of war is client-side only (trusts client, no anti-cheat)
- `SimulationState` includes `nextMerchantId` to avoid module-level mutable state
- Food consumption is from agent personal inventory, not settlement (agents must `take` from settlement)
