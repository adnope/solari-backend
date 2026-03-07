import "@std/dotenv/load";
import { Pool, type PoolClient } from "@db/postgres";

const host = Deno.env.get("POSTGRES_HOST") || "localhost";
const db = Deno.env.get("POSTGRES_DB");
const port = Deno.env.get("POSTGRES_PORT") || "5432";
const user = Deno.env.get("POSTGRES_USER");
const password = Deno.env.get("POSTGRES_PASSWORD");

const poolSize = Number(Deno.env.get("PG_POOL_SIZE") ?? "10");

if (!db || !user || !password) {
  throw new Error(
    "Missing required PostgreSQL environment variables: POSTGRES_DB, POSTGRES_USER, or POSTGRES_PASSWORD",
  );
}

const DATABASE_URL = `postgres://${user}:${password}@${host}:${port}/${db}`;

export const postgresPool = new Pool(DATABASE_URL, poolSize, true);

export async function withDb<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await postgresPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
