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
import openapi from "@elysiajs/openapi";

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
  .use(
    openapi({
      path: "/docs",
      specPath: "/docs/json",
      provider: "scalar",
      documentation: {
        info: {
          title: "Social Backend API",
          version: "1.0.0",
          description: "API documentation for the android frontend of Solari.",
        },
        tags: [
          {
            name: "Auth",
            description: "Authentication operations: Sign up, sign in, sign out,...",
          },
          {
            name: "Conversations",
            description:
              "Messaging operations: Create conversation, send message, react message,...",
          },
          { name: "Feed", description: "Get the user's feed" },
          {
            name: "Friends",
            description: "Social operations: Send friend request, view friends, unfriend,...",
          },
          { name: "Nicknames", description: "Nickname operations: Set/Update/Remove nicknames" },
          {
            name: "Posts",
            description: "Post-related operations: Upload post, react post, view post,...",
          },
          {
            name: "Users",
            description:
              "User-related operations: Update profile, get public profile, block user,...",
          },
        ],
      },
    }),
  )
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
