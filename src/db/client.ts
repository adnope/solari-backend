import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const poolSize = Number(process.env["PG_POOL_SIZE"] ?? "30");

type QueryClient = ReturnType<typeof postgres>;

type DatabaseConnection = {
  databaseUrl: string;
  queryClient: QueryClient;
};

function buildDatabaseUrlFromParams(): string {
  const host = process.env["POSTGRES_HOST"] || "localhost";
  const dbName = process.env["POSTGRES_DB"];
  const port = process.env["POSTGRES_PORT"] || "5432";
  const user = process.env["POSTGRES_USER"];
  const password = process.env["POSTGRES_PASSWORD"];

  if (!dbName || !user || !password) {
    const missingVars: string[] = [];

    if (!dbName) missingVars.push("POSTGRES_DB");
    if (!user) missingVars.push("POSTGRES_USER");
    if (!password) missingVars.push("POSTGRES_PASSWORD");

    throw new Error(
      `Missing required PostgreSQL environment variables: ${missingVars.join(", ")}.`,
    );
  }

  const databaseUrl = new URL("postgres://localhost");
  databaseUrl.hostname = host;
  databaseUrl.port = port;
  databaseUrl.username = user;
  databaseUrl.password = password;
  databaseUrl.pathname = `/${dbName}`;

  return databaseUrl.toString();
}

async function closeQueryClient(queryClient: QueryClient): Promise<void> {
  try {
    await queryClient.end({ timeout: 5 });
  } catch (error) {
    console.error("[WARN] Failed to close unsuccessful PostgreSQL client:", error);
  }
}

async function connect(databaseUrl: string): Promise<QueryClient> {
  const queryClient = postgres(databaseUrl, { max: poolSize });

  try {
    await queryClient`SELECT 1`;
    console.log(`[INFO] Connected to database at: ${databaseUrl}`);
    return queryClient;
  } catch (error) {
    await closeQueryClient(queryClient);
    throw error;
  }
}

async function createDatabaseConnection(): Promise<DatabaseConnection> {
  const envDatabaseUrl = process.env["POSTGRES_DATABASE_URL"]?.trim();

  if (envDatabaseUrl) {
    try {
      return {
        databaseUrl: envDatabaseUrl,
        queryClient: await connect(envDatabaseUrl),
      };
    } catch (error) {
      console.error(
        "[WARN] Failed to connect using POSTGRES_DATABASE_URL. Falling back to POSTGRES_* parameters:",
        error,
      );
    }
  }

  const databaseUrl = buildDatabaseUrlFromParams();

  return {
    databaseUrl,
    queryClient: await connect(databaseUrl),
  };
}

function exitOnConnectionError(error: unknown): never {
  console.error("[ERROR] Failed to connect to PostgreSQL:", error);
  process.exit(1);
}

const connection = await createDatabaseConnection().catch(exitOnConnectionError);

export const DATABASE_URL = connection.databaseUrl;
export const queryClient = connection.queryClient;
export const db = drizzle(queryClient);

export async function withTx<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    return await fn(tx);
  });
}
