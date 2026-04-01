import { Client } from "@colyseus/sdk";

function append(msg: string) {
  const log = document.getElementById("log")!;
  log.textContent += "\n" + msg;
  log.scrollTop = log.scrollHeight;
}

async function connect() {
  const protocol = window.location.protocol === "https:" ? "https" : "http";
  const client = new Client(`${protocol}://${window.location.hostname}:2567`);
  const room = await client.joinOrCreate("chat");
  append(`Connected as ${room.sessionId}`);

  room.onStateChange((state: any) => {
    append(`State updated, players: ${state.players?.size ?? "?"}`);
  });

  room.onMessage("chat", (msg: { from: string; text: string }) => {
    append(`[${msg.from}] ${msg.text}`);
  });

  document.getElementById("hello")!.addEventListener("click", () => {
    append("(sending hello...)");
    room.send("hello");
  });
}

connect().catch((err) => {
  append(`Connection failed: ${err.message}`);
});
