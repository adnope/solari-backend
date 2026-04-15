import { defineConfig } from "drizzle-kit";

const user = process.env["POSTGRES_USER"];
const password = process.env["POSTGRES_PASSWORD"];

const host = process.env["POSTGRES_HOST"] || "localhost";
const port = process.env["POSTGRES_PORT"] || "5432";
const dbName = process.env["POSTGRES_DB"];

if (!user || !password || !dbName) {
  throw new Error("Missing database environment variables for Drizzle Kit");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: `postgres://${user}:${password}@${host}:${port}/${dbName}`,
  },
  verbose: true,
  strict: true,
});
