import app from "./routes/server.ts";
import { wsPublisher } from "./websocket/publisher.ts";
import { wsRoutes } from "./routes/ws.ts";
import { initRedis } from "./jobs/queue.ts";

await initRedis();

app.use(wsRoutes);

const port = process.env["SERVER_PORT"] ?? 5050;

app.listen(port);

if (app.server) {
  wsPublisher.init(app.server);
}

console.log(`[INFO] Server is running at port ${port}`);
