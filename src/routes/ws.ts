import { Elysia } from "elysia";
import { verifyAccessToken } from "../utils/jwt";
import { wsPublisher } from "../websocket/publisher.ts";
import type { WsClientEvent } from "../websocket/types.ts";
import {
  sendTypingState,
  SendTypingStateError,
} from "../usecases/conversations/send_typing_state.ts";

export const wsRoutes = new Elysia()
  .derive(({ headers }) => {
    try {
      const authHeader = headers["authorization"];
      const [scheme, token] = authHeader?.split(" ") ?? [];

      if (scheme !== "Bearer" || !token) {
        return { userId: null };
      }

      const payload = verifyAccessToken(token);

      return {
        userId: payload.sub as string,
      };
    } catch (error) {
      return { userId: null };
    }
  })

  .ws("/ws", {
    open(ws) {
      if (!ws.data.userId) {
        ws.send(JSON.stringify({ error: "Unauthorized" }));
        ws.close();
        return;
      }

      ws.subscribe(ws.data.userId);
    },

    message(ws, incomingData) {
      try {
        const data = incomingData as WsClientEvent;

        if (data.action === "SEND_TYPING_STATE") {
          const senderId = ws.data.userId;

          if (!senderId) return;

          void sendTypingState({
            senderId,
            conversationId: data.payload.conversationId,
            receiverId: data.payload.receiverId,
            isTyping: data.payload.isTyping,
          })
            .then((result) => {
              wsPublisher.sendToUser(result.receiverId, {
                type: "TYPING_INDICATOR",
                payload: {
                  conversationId: result.conversationId,
                  senderId: result.senderId,
                  isTyping: result.isTyping,
                },
              });
            })
            .catch((error: unknown) => {
              if (error instanceof SendTypingStateError) {
                return;
              }

              console.error("[WS] Failed to process typing state", error);
            });
        }
      } catch (error) {
        console.error("[WS] Failed to process incoming message", error);
      }
    },
  });
