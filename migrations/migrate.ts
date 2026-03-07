import { Client } from "@db/postgres";
import { CreateBucketCommand, HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import "@std/dotenv/load";
import { dirname, fromFileUrl, join } from "@std/path";

const MIGRATIONS_DIR = dirname(fromFileUrl(import.meta.url));

function getDatabaseUrl(): string {
  const user = Deno.env.get("POSTGRES_USER");
  const password = Deno.env.get("POSTGRES_PASSWORD");
  const db = Deno.env.get("POSTGRES_DB");
  const host = Deno.env.get("POSTGRES_HOST") || "localhost";
  const port = Deno.env.get("POSTGRES_PORT") || "5432";
  const poolSize = Deno.env.get("PG_POOL_SIZE") || "10";

  if (!user || !password || !db) {
    throw new Error(
      "Missing required environment variables for PostgreSQL.",
    );
  }

  return `postgres://${user}:${password}@${host}:${port}/${db}?poolSize=${poolSize}`;
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

async function ensureMinioBucket() {
  const host = Deno.env.get("MINIO_HOST") || "localhost";
  const port = Deno.env.get("MINIO_PORT") || "9000";
  const accessKeyId = Deno.env.get("MINIO_ROOT_USER");
  const secretAccessKey = Deno.env.get("MINIO_ROOT_PASSWORD");
  const bucketName = Deno.env.get("MINIO_BUCKET_NAME") || "solari-media";

  if (!accessKeyId || !secretAccessKey) {
    console.warn("MinIO credentials missing. Skipping bucket initialization.");
    return;
  }

  const s3Client = new S3Client({
    region: "us-east-1",
    endpoint: `http://${host}:${port}`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`MinIO bucket '${bucketName}' already exists.`);
  } catch (error: unknown) {
    const err = error as Error & {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      console.log(`Created MinIO bucket '${bucketName}'.`);
    } else {
      throw error;
    }
  }
}

if (import.meta.main) {
  await ensureMinioBucket();

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
