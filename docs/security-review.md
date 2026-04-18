# Security Review

OWASP Web Top 10:2025 + LLM Top 10 v2.0 review.
Performed 2026-04-08 against `main` at `c2375fe`.

> **Status:** WIP prototype. No authentication, no persistent storage, localhost-only deployment assumed. Findings are prioritised for when the project moves toward public hosting.

## Findings

### 1. No Authentication or Authorization

- **Category:** A01:2025 Broken Access Control / A07:2025 Authentication Failures
- **Severity:** High (production) / Accepted (prototype)
- **Location:** `server/src/rooms/GameRoom.ts` — `onJoin` (line ~99)
- **Issue:** Any client that can reach the server can join with any name. No tokens, passwords, or session validation. Identity is connection-scoped Colyseus session IDs, not authenticated.
- **Remediation:** Add Colyseus `onAuth()` hook (room password, JWT, or lobby token) before exposing to untrusted networks.

### 2. No Rate Limiting on WebSocket Messages

- **Category:** A02:2025 Security Misconfiguration
- **Severity:** High
- **Location:** `server/src/rooms/GameRoom.ts` — all `onMessage` handlers (lines ~26-91)
- **Issue:** No per-client throttle. A malicious client can spam `input`, `dialogue:advance`, or `dialogue:choose` at arbitrary rates, causing CPU exhaustion or game-state manipulation.
- **Remediation:** Implement per-session message counter reset per tick (e.g., max 16 messages per 125 ms). Drop excess silently.

### 3. No Transport Encryption

- **Category:** A04:2025 Cryptographic Failures
- **Severity:** Medium
- **Location:** `server/src/index.ts` — plain `http.createServer()` (line ~10)
- **Issue:** All game state, player actions, and dialogue content travel in cleartext. Client derives protocol from `window.location.protocol` so HTTPS works if provided, but the server has no TLS configuration.
- **Remediation:** Terminate TLS via reverse proxy (nginx/Caddy) for any non-localhost deployment.

### 4. Player Name Not Character-Restricted

- **Category:** A05:2025 Injection
- **Severity:** Low
- **Location:** `server/src/rooms/GameRoom.ts` — line ~113
- **Issue:** Name is trimmed and length-capped (32 chars) but accepts arbitrary characters. Client currently uses `textContent` (safe), but control characters, RTL overrides, or HTML in names could cause issues if rendering changes. Server `console.log` includes unsanitised names.
- **Remediation:** Validate against an allowlist pattern (e.g., `/^[\w\s-]{1,32}$/`).

### 5. LLM Prompt Injection via Agent Beliefs

- **Category:** LLM01 Prompt Injection
- **Severity:** Medium
- **Location:** `server/src/ai/prompt-builder.ts` — lines ~43-54
- **Issue:** Belief key-value pairs are interpolated directly into LLM prompts as free text. Beliefs propagate between agents via memory merge. If a belief contains adversarial strings, they enter the prompt. Currently beliefs are set only by hardcoded dialogue trees, but the surface widens with any dynamic belief source.
- **Remediation:** Sanitise/escape belief content before interpolation. Consider structured (JSON) prompt format. Cap belief value length.

### 6. LLM Response — No Action Count Cap

- **Category:** LLM05 Improper Output Handling
- **Severity:** Low
- **Location:** `server/src/ai/response-parser.ts` — `parseResponse` (line ~42)
- **Issue:** `parseResponse` validates action types (whitelist) and falls back to idle on bad JSON — good. But it does not cap the array length, so an adversarial or hallucinating LLM could return hundreds of actions that fill `planBacklog`.
- **Remediation:** Cap at e.g. 8 actions in `parseResponse`.

### 7. No Structured Logging

- **Category:** A09:2025 Security Logging and Alerting Failures
- **Severity:** Medium
- **Location:** Project-wide
- **Issue:** Only `console.log` for join/leave and `console.error` for LLM failures. No logging of validation rejections, combat, item transfers, or connection patterns. Abuse detection is impossible.
- **Remediation:** Add structured logging (e.g., pino) for security-relevant events when moving to production.

### 8. Unbounded Room and Agent Creation

- **Category:** A02:2025 Security Misconfiguration / LLM10 Unbounded Consumption
- **Severity:** Medium
- **Location:** `server/src/index.ts` — `gameServer.define` (line ~16); `GameRoom.ts` — `onJoin`
- **Issue:** No `maxClients` on the room, no global room count limit. Disconnected players become persistent bot agents. An attacker could exhaust memory with accumulated agents.
- **Remediation:** Set `maxClients` on room definition. Clean up dead bot agents after a grace period.

### 9. Dialogue Session Leak on Agent Death

- **Category:** A10:2025 Mishandling of Exceptional Conditions
- **Severity:** Low
- **Location:** `server/src/rooms/GameRoom.ts` — `checkPlayerDeaths` (line ~218)
- **Issue:** If an agent dies mid-dialogue, `checkPlayerDeaths` removes the session mapping without cleaning the NPC's dialogue lock (`currentTalkingTo`), potentially leaving the NPC permanently "busy".
- **Remediation:** Add dialogue cleanup to the death handler.

### 10. `input:stop` Seq Advancement

- **Category:** A05:2025 Injection
- **Severity:** Info
- **Location:** `server/src/rooms/GameRoom.ts` — lines ~36-46
- **Issue:** A client can send `{ seq: 999999999 }` to advance `lastProcessedInput` far into the future, causing all subsequent real inputs to be rejected as stale. Effectively a self-DoS requiring reconnect.
- **Remediation:** Clamp `input:stop` seq to the highest enqueued seq + small margin.

### 11. Client Hardcoded Port

- **Category:** A02:2025 Security Misconfiguration
- **Severity:** Info
- **Location:** `client/src/network.ts` — line ~29
- **Issue:** Client hardcodes port `2567`. Deploying behind a reverse proxy on 443 requires client changes, which could lead to insecure workarounds.
- **Remediation:** Derive WebSocket URL from `window.location` (same origin) or make configurable.

## Summary

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1 | No authentication | High | A01/A07 |
| 2 | No rate limiting | High | A02 |
| 3 | No TLS | Medium | A04 |
| 4 | Player name unsanitised | Low | A05 |
| 5 | LLM prompt injection via beliefs | Medium | LLM01 |
| 6 | LLM response unbounded | Low | LLM05 |
| 7 | No structured logging | Medium | A09 |
| 8 | Unbounded rooms/agents | Medium | A02/LLM10 |
| 9 | Dialogue leak on death | Low | A10 |
| 10 | `input:stop` seq gap | Info | A05 |
| 11 | Hardcoded client port | Info | A02 |

## What's Already Good

- **Input validation** (`validation.ts`): thorough whitelists for actions, directions, resources, safe-integer seq checks
- **Expression evaluator**: strict AST-based evaluation with no arbitrary code execution
- **Client rendering**: `textContent` and Canvas 2D throughout — no `innerHTML` XSS surface
- **LLM response parser**: safe JSON parse with fallback to `idle` on invalid input
- **Execution layer**: server-side adjacency, bounds, and resource checks on every action
- **Vision filtering**: fog of war enforced server-side, per-player state filtering
- **Schema sync**: one-way server-to-client; clients cannot modify authoritative state
