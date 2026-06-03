import { Elysia } from "elysia";
import { node } from "@elysia/node";
import { eq, and, gt } from "drizzle-orm";
import { publishWebSocketEvent } from "../jobs/queue.ts";
import { verifyAccessToken } from "../utils/jwt.ts";
import { wsPublisher } from "../websocket/publisher.ts";
import { db } from "../db/client.ts";
import { sessions } from "../db/schema.ts";
import {
  getCachedAuthSession,
  cacheAuthSession,
  type CachedAuthSession,
} from "../cache/auth_session_cache.ts";
import type { WsClientEvent } from "../websocket/types.ts";
import { sendTypingState } from "../usecases/conversations/send_typing_state.ts";

async function getValidSession(
  sessionId: string,
  userId: string,
): Promise<CachedAuthSession | null> {
  const cached = await getCachedAuthSession(sessionId);

  if (cached && cached.userId === userId) {
    return cached;
  }

  const [session] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, sessionId),
        eq(sessions.userId, userId),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  if (!session) {
    return null;
  }

  await cacheAuthSession(session);
  return session;
}

export const wsRoutes = new Elysia({ adapter: node() })
  .derive(async ({ headers }) => {
    try {
      const authHeader = headers["authorization"];
      const [scheme, token] = authHeader?.split(" ") ?? [];

      if (scheme !== "Bearer" || !token) {
        return { userId: null };
      }

      const payload = verifyAccessToken(token);
      const session = await getValidSession(payload.sid, payload.sub);

      if (!session) {
        return { userId: null };
      }

      return {
        userId: session.userId,
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

      wsPublisher.add(ws.data.userId, ws);
    },

    close(ws) {
      if (ws.data.userId) {
        wsPublisher.remove(ws.data.userId, ws);
      }
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
              return publishWebSocketEvent(result.receiverId, {
                type: "TYPING_INDICATOR",
                payload: {
                  conversationId: result.conversationId,
                  senderId: result.senderId,
                  isTyping: result.isTyping,
                },
              });
            })
            .catch((error: unknown) => {
              console.error("[WS] Failed to process typing state", error);
            });
        }
      } catch (error) {
        console.error("[WS] Failed to process incoming message", error);
      }
    },
  });
