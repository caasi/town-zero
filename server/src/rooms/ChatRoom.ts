import { Room, Client } from "@colyseus/core";
import { schema, type SchemaType } from "@colyseus/schema";

const Player = schema({ name: "string" }, "Player");
type Player = SchemaType<typeof Player>;

const ChatState = schema({
  players: { map: Player },
}, "ChatState");
type ChatState = SchemaType<typeof ChatState>;

export class ChatRoom extends Room<ChatState> {
  private nextId = 0;

  onCreate() {
    this.setState(new ChatState());

    this.onMessage("hello", (client: Client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      this.broadcast("chat", { from: player.name, text: "Hello!" });
    });

    console.log("ChatRoom created");
  }

  onJoin(client: Client) {
    const player = new Player();
    player.name = `Player-${this.nextId++}`;
    this.state.players.set(client.sessionId, player);
    console.log(`${player.name} joined (${client.sessionId})`);
  }

  onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    console.log(`${player?.name} left (${client.sessionId})`);
    this.state.players.delete(client.sessionId);
  }
}
