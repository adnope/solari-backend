import { Pool, PoolClient } from "@db/postgres";
import "@std/dotenv/load";

const host = Deno.env.get("POSTGRES_HOST") || "localhost";
const db = Deno.env.get("POSTGRES_DB");
const port = Deno.env.get("POSTGRES_PORT") || "5432";
const user = Deno.env.get("POSTGRES_USER");
const password = Deno.env.get("POSTGRES_PASSWORD");

const poolSize = Number(Deno.env.get("PG_POOL_SIZE") ?? "10");

if (!db || !user || !password) {
  throw new Error("Missing required PostgreSQL environment variables.");
}

const DATABASE_URL = `postgres://${user}:${password}@${host}:${port}/${db}`;

export const pool = new Pool(DATABASE_URL, poolSize);

try {
  const client = await pool.connect();
  await client.queryArray`SELECT 1`;
  client.release();
  console.log(`[INFO] Connected to PostgreSQL at ${host}:${port}/${db}`);
} catch (error) {
  console.error(`[ERROR] Failed to connect to PostgreSQL at ${host}:${port}:`, error);
}

export async function withDb<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
