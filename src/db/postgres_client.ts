import { SQL } from "bun";

const host = process.env.POSTGRES_HOST || "localhost";
const db = process.env.POSTGRES_DB;
const port = process.env.POSTGRES_PORT || "5432";
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;

const poolSize = Number(process.env.PG_POOL_SIZE ?? "10");

if (!db || !user || !password) {
  throw new Error(
    "Missing required PostgreSQL environment variables: POSTGRES_DB, POSTGRES_USER, or POSTGRES_PASSWORD",
  );
}

const DATABASE_URL = `postgres://${user}:${password}@${host}:${port}/${db}`;

export const sql = new SQL({
  url: DATABASE_URL,
  max: poolSize,
});

try {
  await sql`SELECT 1`;
  console.log(`[INFO] Connected to PostgreSQL at ${host}:${port}/${db}`);
} catch (error) {
  console.error(`[ERROR] Failed to connect to PostgreSQL at ${host}:${port}:`, error);
}

export async function withDb<T>(fn: (client: SQL) => Promise<T>): Promise<T> {
  return await fn(sql);
}