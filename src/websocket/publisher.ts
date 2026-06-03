import type { WsServerEvent } from "./types.ts";

type WebSocketConnection = {
  send(message: string): unknown;
};

const socketsByUserId = new Map<string, Set<WebSocketConnection>>();

function getSocketSet(userId: string): Set<WebSocketConnection> {
  const existing = socketsByUserId.get(userId);
  if (existing) {
    return existing;
  }

  const created = new Set<WebSocketConnection>();
  socketsByUserId.set(userId, created);
  return created;
}

export const wsPublisher = {
  add(userId: string, socket: WebSocketConnection): void {
    getSocketSet(userId).add(socket);
  },

  remove(userId: string, socket: WebSocketConnection): void {
    const sockets = socketsByUserId.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      socketsByUserId.delete(userId);
    }
  },

  sendToUser(userId: string, event: WsServerEvent): void {
    const sockets = socketsByUserId.get(userId);
    if (!sockets || sockets.size === 0) {
      return;
    }

    const payload = JSON.stringify(event);
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch (error) {
        sockets.delete(socket);
        console.warn("[WARN] Failed to send WebSocket event.", error);
      }
    }

    if (sockets.size === 0) {
      socketsByUserId.delete(userId);
    }
  },
};
