import { Client } from "@db/postgres";
import "@std/dotenv/load";
import { dirname, fromFileUrl, join } from "@std/path";

const MIGRATIONS_DIR = dirname(fromFileUrl(import.meta.url));
console.log(MIGRATIONS_DIR);

function getDatabaseUrl(): string {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL. Example: DATABASE_URL=postgres://solari:password@localhost:5432/solari",
    );
  }
  return url;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function connectWithRetry(client: Client, tries = 30) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await client.connect();
      return;
    } catch (e) {
      lastErr = e;
      await sleep(250);
    }
  }
  throw lastErr;
}

async function ensureMigrationsTable(client: Client) {
  await client.queryArray(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client: Client): Promise<Set<string>> {
  const res = await client.queryObject<{ filename: string }>(
    `SELECT filename FROM schema_migrations`,
  );
  return new Set(res.rows.map((r) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(MIGRATIONS_DIR)) {
    if (entry.isFile && entry.name.endsWith(".sql")) files.push(entry.name);
  }
  files.sort();
  return files;
}

async function applyMigration(client: Client, filename: string) {
  const sqlPath = join(MIGRATIONS_DIR, filename);
  const sql = await Deno.readTextFile(sqlPath);

  await client.queryArray("BEGIN");
  try {
    await client.queryArray(sql);
    await client.queryArray(
      `INSERT INTO schema_migrations(filename) VALUES ($1)`,
      [filename],
    );
    await client.queryArray("COMMIT");
    console.log(`Applied ${filename}`);
  } catch (e) {
    await client.queryArray("ROLLBACK");
    throw e;
  }
}

if (import.meta.main) {
  const client = new Client(getDatabaseUrl());
  await connectWithRetry(client);

  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);
    const files = await listMigrationFiles();

    for (const f of files) {
      if (applied.has(f)) {
        console.log(`Skipped ${f} (already applied)`);
        continue;
      }
      await applyMigration(client, f);
    }

    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}
