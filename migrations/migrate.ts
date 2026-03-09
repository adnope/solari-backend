import { SQL } from "bun";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client as AwsS3Client,
} from "@aws-sdk/client-s3";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

const MIGRATIONS_DIR = import.meta.dir;

function getDatabaseUrl(): string {
  const user = process.env.POSTGRES_USER;
  const password = process.env.POSTGRES_PASSWORD;
  const db = process.env.POSTGRES_DB;
  const host = process.env.POSTGRES_HOST || "localhost";
  const port = process.env.POSTGRES_PORT || "5432";

  if (!user || !password || !db) {
    throw new Error("Missing required environment variables for PostgreSQL.");
  }

  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

async function connectWithRetry(client: SQL, tries = 30) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      await client`SELECT 1`;
      return;
    } catch (e) {
      lastErr = e;
      await Bun.sleep(250);
    }
  }
  throw lastErr;
}

async function ensureMigrationsTable(client: SQL) {
  await client`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `.simple();
}

async function getApplied(client: SQL): Promise<Set<string>> {
  const res = await client`SELECT filename FROM schema_migrations`;
  return new Set(res.map((r: any) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith(".sql")).sort();
}

async function applyMigration(client: SQL, filename: string) {
  const sqlPath = join(MIGRATIONS_DIR, filename);

  await client.begin(async (tx) => {
    await tx.file(sqlPath).simple();

    await tx`INSERT INTO schema_migrations(filename) VALUES (${filename})`;
  });

  console.log(`Applied ${filename}`);
}

async function ensureMinioBucket() {
  const host = process.env.MINIO_HOST || "localhost";
  const port = process.env.MINIO_PORT || "9000";
  const accessKeyId = process.env.MINIO_ROOT_USER;
  const secretAccessKey = process.env.MINIO_ROOT_PASSWORD;
  const bucketName = process.env.MINIO_BUCKET_NAME || "solari-media";

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

  const maxConnections = parseInt(process.env.PG_POOL_SIZE || "10", 10);

  const client = new SQL({
    url: getDatabaseUrl(),
    max: maxConnections,
  });

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
    await client.close();
  }
}
