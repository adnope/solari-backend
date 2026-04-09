import { Elysia } from "elysia";
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { redisClient } from "../jobs/queue.ts";

import authRouter from "./auth.ts";
import conversationsRouter from "./conversations.ts";
import feedRouter from "./feed.ts";
import friendsRouter from "./friends.ts";
import postsRouter from "./posts.ts";
import usersRouter from "./users.ts";
import { webRouter } from "./web.ts";
import nicknamesRouter from "./nicknames.ts";

const healthRouter = new Elysia().get("/health", async ({ set }) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    services: {
      api: "up",
      database: "down",
      redis: "down",
    },
  };

  let isHealthy = true;

  try {
    await db.execute(sql`SELECT 1`);
    health.services.database = "up";
  } catch (error) {
    console.error("[HEALTH] Database connection failed:", error);
    health.services.database = "down";
    isHealthy = false;
  }

  try {
    const ping = await redisClient.ping();
    if (ping === "PONG") {
      health.services.redis = "up";
    } else {
      health.services.redis = "down";
      isHealthy = false;
    }
  } catch (error) {
    console.error("[HEALTH] Redis connection failed:", error);
    health.services.redis = "down";
    isHealthy = false;
  }

  if (!isHealthy) {
    health.status = "unhealthy";
    set.status = 503;
  } else {
    set.status = 200;
  }

  return health;
});

const app = new Elysia()
  .use(healthRouter)
  .use(authRouter)
  .use(friendsRouter)
  .use(postsRouter)
  .use(feedRouter)
  .use(usersRouter)
  .use(conversationsRouter)
  .use(nicknamesRouter)
  .use(webRouter);

export default app;
