import { Elysia, t } from "elysia";
import { verifyAccessToken } from "../utils/jwt";
import { wsPublisher } from "../websocket/publisher.ts";
import type { WsClientEvent } from "../websocket/types.ts";

export const wsRoutes = new Elysia()
  .derive(({ query }) => {
    try {
      const payload = verifyAccessToken(query?.["token"] as string);

      return {
        userId: payload.sub as string,
      };
    } catch (error) {
      console.error("[WS Auth Error]:", error);
      return { userId: null };
    }
  })

  .ws("/ws", {
    query: t.Object({
      token: t.String(),
    }),

    open(ws) {
      if (!ws.data.userId) {
        ws.send(JSON.stringify({ error: "Unauthorized" }));
        ws.close();
        return;
      }

      ws.subscribe(ws.data.userId);
      console.log(`[WS] User ${ws.data.userId} connected.`);
    },

    message(ws, incomingData) {
      try {
        const data = incomingData as WsClientEvent;

        if (data.action === "SEND_TYPING_STATE") {
          const senderId = ws.data.userId;

          if (!senderId) return;

          wsPublisher.sendToUser(data.payload.receiverId, {
            type: "TYPING_INDICATOR",
            payload: {
              conversationId: data.payload.conversationId,
              senderId: senderId,
              isTyping: data.payload.isTyping,
            },
          });
        }
      } catch (error) {
        console.error("[WS] Failed to process incoming message", error);
      }
    },

    close(ws) {
      if (ws.data.userId) {
        console.log(`[WS] User ${ws.data.userId} disconnected.`);
      }
    },
  });
