import { Hono } from "@hono/hono";
import authRouter from "./auth.ts";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Solari backend is running.");
});

app.route("/auth", authRouter);

export default app;
