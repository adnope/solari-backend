import app from "./routes/server.ts";
import { wsRoutes } from "./routes/ws.ts";
import { initRedis } from "./jobs/queue.ts";

await initRedis();

app.use(wsRoutes);

const port = 5050;

app.listen({ port, hostname: "0.0.0.0" });

console.log(`[INFO] Server is running at port ${port}`);
