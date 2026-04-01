import "./polyfill.js";
import { createServer } from "http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ChatRoom } from "./rooms/ChatRoom.js";

const port = Number(process.env.PORT ?? 2567);
const httpServer = createServer();

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("chat", ChatRoom);

gameServer.listen(port).then(() => {
  console.log(`town-zero server listening on port ${port}`);
});
