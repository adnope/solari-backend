import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client as AwsS3Client,
} from "@aws-sdk/client-s3";
import { Client } from "@db/postgres";
import "@std/dotenv/load";
import { join } from "@std/path";

const MIGRATIONS_DIR = import.meta.dirname || new URL(".", import.meta.url).pathname;

function getDatabaseUrl(): string {
  const user = Deno.env.get("POSTGRES_USER");
  const password = Deno.env.get("POSTGRES_PASSWORD");
  const db = Deno.env.get("POSTGRES_DB");
  const host = Deno.env.get("POSTGRES_HOST") || "localhost";
  const port = Deno.env.get("POSTGRES_PORT") || "5432";

  if (!user || !password || !db) {
    throw new Error("Missing required environment variables for PostgreSQL.");
  }

  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

async function connectWithRetry(client: Client, tries = 30) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await client.connect();
      await client.queryArray`SELECT 1`;
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastErr;
}

async function ensureMigrationsTable(client: Client) {
  await client.queryArray`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `;
}

async function getApplied(client: Client): Promise<Set<string>> {
  const res = await client.queryObject<
    { filename: string }
  >`SELECT filename FROM schema_migrations`;
  return new Set(res.rows.map((r) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const dirEntry of Deno.readDir(MIGRATIONS_DIR)) {
    if (dirEntry.isFile && dirEntry.name.endsWith(".sql")) {
      files.push(dirEntry.name);
    }
  }
  return files.sort();
}

async function applyMigration(client: Client, filename: string) {
  const sqlPath = join(MIGRATIONS_DIR, filename);
  const sqlContent = await Deno.readTextFile(sqlPath);

  const txName = filename.replace(/[^a-zA-Z0-9_]/g, "_");
  const tx = client.createTransaction(txName);

  await tx.begin();
  try {
    await tx.queryArray(sqlContent);
    await tx.queryArray`INSERT INTO schema_migrations (filename) VALUES (${filename})`;
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
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

  const s3Client = new AwsS3Client({
    region: "us-east-1",
    endpoint: `http://${host}:${port}`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`MinIO bucket '${bucketName}' already exists.`);
    // deno-lint-ignore no-explicit-any
  } catch (error: any) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
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
      console.log(`Applied migration: ${f}`);
    }

    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}
