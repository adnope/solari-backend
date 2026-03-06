import app from "./routes/server.ts";
import "@std/dotenv/load";

Deno.serve({ port: Number(Deno.env.get("SERVER_PORT") ?? "5050") }, app.fetch);
