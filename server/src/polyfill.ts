// Symbol.metadata is not implemented in any V8/Node.js version yet.
// @colyseus/schema v4 ships a shim but its import order is buggy —
// the encoder loads before the shim runs. This must execute before
// any @colyseus import.
//
// IMPORTANT: This file must NOT import @colyseus/schema or any module
// that depends on it. Static imports are hoisted and evaluated before
// the module body runs, which would defeat the Symbol.metadata shim.
(Symbol as any).metadata ??= Symbol.for("Symbol.metadata");
