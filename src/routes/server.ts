import { Hono } from "@hono/hono";
import authRouter from "./auth.ts";
import friendsRouter from "./friends.ts";
import { AuthVariables } from "../middleware/require_auth.ts";
import postsRouter from "./posts.ts";

const app = new Hono<{
  Variables: AuthVariables;
}>();

app.route("/", authRouter);
app.route("/", friendsRouter);
app.route("/", postsRouter);

export default app;
