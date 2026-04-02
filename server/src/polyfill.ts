// Symbol.metadata is not implemented in any V8/Node.js version yet.
// @colyseus/schema v4 ships a shim but its import order is buggy —
// the encoder loads before the shim runs. This must execute before
// any @colyseus import.
(Symbol as any).metadata ??= Symbol.for("Symbol.metadata");

// 40x40 grid (1600 tiles) exceeds the default 8KB encoder buffer.
// Must run before any schema encoding occurs. Imported by both
// server entry point and test setup.
import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 64 * 1024;
