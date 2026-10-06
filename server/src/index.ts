import "./polyfill.js";
import "./encoder-config.js";
import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";
import { createStaticServer } from "./http/static-server.js";

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`town-zero server listening on port ${port}`);
});

// Production only: serve the built client next to the game server.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const staticPort = Number(process.env.STATIC_PORT ?? 2568);
  createStaticServer(staticDir).listen(staticPort, () => {
    console.log(`client files from ${staticDir} on port ${staticPort}`);
  });
}
