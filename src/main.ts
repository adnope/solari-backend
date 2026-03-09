import app from "./routes/server.ts";

const port = Number(process.env.SERVER_PORT ?? "5050");

export default {
  port,
  fetch: app.fetch,
};
