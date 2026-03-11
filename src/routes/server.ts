import { Hono } from "hono";
import type { AuthVariables } from "../middleware/require_auth.ts";
import authRouter from "./auth.ts";
import conversationsRouter from "./conversations.ts";
import feedRouter from "./feed.ts";
import friendsRouter from "./friends.ts";
import postsRouter from "./posts.ts";
import usersRouter from "./users.ts";
import { webRouter } from "./web.ts";

const app = new Hono<{
  Variables: AuthVariables;
}>();

app.route("/", authRouter);
app.route("/", friendsRouter);
app.route("/", postsRouter);
app.route("/", feedRouter);
app.route("/", usersRouter);
app.route("/", conversationsRouter);
app.route("/", webRouter);

export default app;
