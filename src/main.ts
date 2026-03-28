import app from "./routes/server.ts";

const port = process.env["SERVER_PORT"] ?? 5050;
app.listen(port);
console.log(`[INFO] Server listening on port ${app.server?.port}`);
