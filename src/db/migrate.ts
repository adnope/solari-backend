import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
const BASELINE_TAG = "0000_dapper_nightshade";
const BASELINE_SCHEMA_FINGERPRINT = "38d4237769d65aeb10aada2a4dd1c252";
const BASELINE_CATALOG_ENTRY_COUNT = 278;
const MIGRATION_LOCK_ID = 7_364_291_805;

type MigrationJournal = {
  entries: Array<{
    tag: string;
    when: number;
  }>;
};

type BaselineMetadata = {
  hash: string;
  createdAt: number;
};

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(currentDirectory, "migrations");

function buildDatabaseUrl(): string {
  const configuredUrl = process.env["POSTGRES_DATABASE_URL"]?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const host = process.env["POSTGRES_HOST"] || "localhost";
  const port = process.env["POSTGRES_PORT"] || "5432";
  const database = process.env["POSTGRES_DB"];
  const user = process.env["POSTGRES_USER"];
  const password = process.env["POSTGRES_PASSWORD"];

  const missingVariables = [
    ["POSTGRES_DB", database],
    ["POSTGRES_USER", user],
    ["POSTGRES_PASSWORD", password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingVariables.length > 0) {
    throw new Error(`Missing required PostgreSQL variables: ${missingVariables.join(", ")}.`);
  }

  const url = new URL("postgres://localhost");
  url.hostname = host;
  url.port = port;
  url.username = user!;
  url.password = password!;
  url.pathname = `/${database!}`;
  return url.toString();
}

async function readBaselineMetadata(): Promise<BaselineMetadata> {
  const journal = (await Bun.file(
    join(migrationsFolder, "meta", "_journal.json"),
  ).json()) as MigrationJournal;
  const baselineEntry = journal.entries.find((entry) => entry.tag === BASELINE_TAG);

  if (!baselineEntry) {
    throw new Error(`Migration journal does not contain baseline '${BASELINE_TAG}'.`);
  }

  const baselineSql = await Bun.file(join(migrationsFolder, `${BASELINE_TAG}.sql`)).text();
  return {
    hash: createHash("sha256").update(baselineSql).digest("hex"),
    createdAt: baselineEntry.when,
  };
}

const schemaFingerprintQuery = `
  WITH parts AS (
    SELECT 'table|' || tablename AS item
    FROM pg_tables
    WHERE schemaname = 'public'

    UNION ALL

    SELECT
      'column|' || c.relname || '|' || a.attnum || '|' || a.attname || '|' ||
      pg_catalog.format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull || '|' ||
      coalesce(pg_get_expr(ad.adbin, ad.adrelid), '')
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attnum > 0
      AND NOT a.attisdropped

    UNION ALL

    SELECT
      'constraint|' || c.relname || '|' || con.conname || '|' || con.contype::text || '|' ||
      pg_get_constraintdef(con.oid, true)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'

    UNION ALL

    SELECT 'index|' || tablename || '|' || indexname || '|' || indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'

    UNION ALL

    SELECT 'extension|' || extname
    FROM pg_extension
  )
  SELECT
    md5(string_agg(item, E'\\n' ORDER BY item)) AS fingerprint,
    count(*)::integer AS catalog_entry_count
  FROM parts
`;

async function hasApplicationTables(client: ReturnType<typeof postgres>): Promise<boolean> {
  const [row] = await client<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM pg_tables
    WHERE schemaname = 'public'
  `;
  return (row?.count ?? 0) > 0;
}

async function migrationLedgerExists(client: ReturnType<typeof postgres>): Promise<boolean> {
  const [row] = await client<{ exists: boolean }[]>`
    SELECT to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) IS NOT NULL AS exists
  `;
  return row?.exists ?? false;
}

async function migrationLedgerIsEmpty(client: ReturnType<typeof postgres>): Promise<boolean> {
  const [row] = await client<{ count: number }[]>`
    SELECT count(*)::integer AS count
    FROM drizzle.__drizzle_migrations
  `;
  return (row?.count ?? 0) === 0;
}

async function baselineExistingDatabase(
  client: ReturnType<typeof postgres>,
  baseline: BaselineMetadata,
): Promise<void> {
  const [signature] =
    await client.unsafe<Array<{ fingerprint: string | null; catalog_entry_count: number }>>(
      schemaFingerprintQuery,
    );

  if (
    signature?.fingerprint !== BASELINE_SCHEMA_FINGERPRINT ||
    signature.catalog_entry_count !== BASELINE_CATALOG_ENTRY_COUNT
  ) {
    throw new Error(
      [
        "Existing database schema does not match the verified Drizzle baseline.",
        `Expected fingerprint ${BASELINE_SCHEMA_FINGERPRINT} (${BASELINE_CATALOG_ENTRY_COUNT} entries).`,
        `Received fingerprint ${signature?.fingerprint ?? "null"} (${signature?.catalog_entry_count ?? 0} entries).`,
        "Refusing to mark the baseline as applied.",
      ].join(" "),
    );
  }

  await client.begin(async (transaction) => {
    await transaction.unsafe(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await transaction.unsafe(`
      CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const existingRows = await transaction.unsafe<{ count: number }[]>(`
      SELECT count(*)::integer AS count
      FROM drizzle.__drizzle_migrations
    `);

    if ((existingRows[0]?.count ?? 0) === 0) {
      await transaction.unsafe(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [baseline.hash, baseline.createdAt],
      );
    }
  });

  console.log("[INFO] Existing database matches the baseline; recorded it as applied.");
}

async function validateRecordedBaseline(
  client: ReturnType<typeof postgres>,
  baseline: BaselineMetadata,
): Promise<void> {
  const rows = await client<Array<{ hash: string; created_at: string }>>`
    SELECT hash, created_at
    FROM drizzle.__drizzle_migrations
    WHERE created_at = ${baseline.createdAt}
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error(
      `Migration ledger contains entries but does not contain baseline ${BASELINE_TAG}.`,
    );
  }

  if (rows[0]!.hash !== baseline.hash) {
    throw new Error(
      `Recorded baseline hash does not match ${BASELINE_TAG}. Refusing to run migrations.`,
    );
  }
}

async function run(): Promise<void> {
  const baseline = await readBaselineMetadata();
  const client = postgres(buildDatabaseUrl(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;

    const ledgerExists = await migrationLedgerExists(client);
    const ledgerNeedsBaseline =
      !ledgerExists || (ledgerExists && (await migrationLedgerIsEmpty(client)));
    const applicationTablesExist = await hasApplicationTables(client);

    if (ledgerNeedsBaseline && applicationTablesExist) {
      await baselineExistingDatabase(client, baseline);
    } else if (ledgerExists && !ledgerNeedsBaseline) {
      await validateRecordedBaseline(client, baseline);
    }

    await client`CREATE EXTENSION IF NOT EXISTS citext`;

    const database = drizzle(client);
    await migrate(database, {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });

    console.log("[INFO] Database migrations completed successfully.");
  } finally {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => undefined);
    await client.end({ timeout: 5 });
  }
}

run().catch((error: unknown) => {
  console.error("[ERROR] Database migration failed:", error);
  process.exit(1);
});
