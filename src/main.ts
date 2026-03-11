import app from "./routes/server.ts";
import "@std/dotenv/load";

const port = Number(Deno.env.get("SERVER_PORT") ?? "5050");

Deno.serve({ port: port }, app.fetch);
