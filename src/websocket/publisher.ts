import type { Server } from "bun";
import type { WsServerEvent } from "./types.ts";

interface WebSocketData {
  userId: string;
}

let bunServer: Server<WebSocketData> | null = null;

export const wsPublisher = {
  init(server: Server<WebSocketData>) {
    bunServer = server;
  },

  sendToUser(userId: string, event: WsServerEvent) {
    if (!bunServer) {
      console.warn(
        "[WARN] Attempted to publish WebSocket event before the server was initialized.",
      );
      return;
    }

    bunServer.publish(userId, JSON.stringify(event));
  },
};
