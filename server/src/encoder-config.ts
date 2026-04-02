// 40x40 grid (1600 tiles) exceeds the default 8KB encoder buffer.
// Must be imported after polyfill.ts (which sets Symbol.metadata)
// and before any schema encoding occurs.
import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 64 * 1024;
