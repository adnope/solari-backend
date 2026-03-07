import { Hono } from "@hono/hono";
import authRouter from "./auth.ts";
import friendRouter from "./friends.ts";
import { AuthVariables } from "../middleware/require_auth.ts";

const app = new Hono<{
  Variables: AuthVariables;
}>();

app.route("/", authRouter);
app.route("/", friendRouter);

export default app;
