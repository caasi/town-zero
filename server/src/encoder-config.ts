// external: 40x40 grid (1600 tiles) exceeds the default 8KB encoder buffer.
import { Encoder } from "@colyseus/schema";
Encoder.BUFFER_SIZE = 128 * 1024;
