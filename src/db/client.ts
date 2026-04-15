import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const host = process.env["POSTGRES_HOST"] || "localhost";
const dbName = process.env["POSTGRES_DB"];
const port = process.env["POSTGRES_PORT"] || "5432";
const user = process.env["POSTGRES_USER"];
const password = process.env["POSTGRES_PASSWORD"];
const poolSize = Number(process.env["PG_POOL_SIZE"] ?? "30");

if (!dbName || !user || !password) {
  throw new Error("Missing required PostgreSQL environment variables.");
}

export const DATABASE_URL = `postgres://${user}:${password}@${host}:${port}/${dbName}`;

export const queryClient = postgres(DATABASE_URL, { max: poolSize });

export const db = drizzle(queryClient);

console.log("=====================================================");
try {
  await queryClient`SELECT 1`;
  console.log(`[INFO] Connected to PostgreSQL at ${host}:${port}/${dbName}`);
} catch (error) {
  console.error(`[ERROR] Failed to connect to PostgreSQL at ${host}:${port}:`, error);
  process.exit(1);
}

export async function withTx<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    return await fn(tx);
  });
}
