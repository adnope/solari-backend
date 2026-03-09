import { Hono } from "hono";
import authRouter from "./auth.ts";
import friendsRouter from "./friends.ts";
import type { AuthVariables } from "../middleware/require_auth.ts";
import postsRouter from "./posts.ts";
import feedRouter from "./feed.ts";
import usersRouter from "./users.ts";
import conversationsRouter from "./conversations.ts";

const app = new Hono<{
  Variables: AuthVariables;
}>();

app.route("/", authRouter);
app.route("/", friendsRouter);
app.route("/", postsRouter);
app.route("/", feedRouter);
app.route("/", usersRouter);
app.route("/", conversationsRouter);

export default app;
