import "@std/dotenv/load";
import { Pool, type PoolClient } from "@db/postgres";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in environment.");
}

const POOL_SIZE = Number(Deno.env.get("PG_POOL_SIZE") ?? "10");

export const postgresPool = new Pool(DATABASE_URL, POOL_SIZE, true);

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