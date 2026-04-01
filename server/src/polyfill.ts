// Symbol.metadata is not implemented in any V8/Node.js version yet.
// @colyseus/schema v4 ships a shim but its import order is buggy —
// the encoder loads before the shim runs. This must execute before
// any @colyseus import.
(Symbol as any).metadata ??= Symbol.for("Symbol.metadata");
