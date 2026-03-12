import { Elysia } from "elysia";
import authRouter from "./auth.ts";
import conversationsRouter from "./conversations.ts";
import feedRouter from "./feed.ts";
import friendsRouter from "./friends.ts";
import postsRouter from "./posts.ts";
import usersRouter from "./users.ts";
import { webRouter } from "./web.ts";

const app = new Elysia()
  .use(authRouter)
  .use(friendsRouter)
  .use(postsRouter)
  .use(feedRouter)
  .use(usersRouter)
  .use(conversationsRouter)
  .use(webRouter);

export default app;
