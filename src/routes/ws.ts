import { Elysia, t } from "elysia";
import { verifyAccessToken } from "../utils/jwt";

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

    close(ws) {
      if (ws.data.userId) {
        console.log(`[WS] User ${ws.data.userId} disconnected.`);
      }
    },
  });
