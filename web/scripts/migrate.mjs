import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running npm run db:migrate");
}

const sql = neon(databaseUrl);
await sql.query(
  `CREATE TABLE IF NOT EXISTS kairo_schema_migrations (
     migration_name text PRIMARY KEY,
     applied_at timestamptz NOT NULL DEFAULT now()
   )`,
  [],
);
const appliedRows = await sql.query(
  `SELECT migration_name AS "migrationName"
   FROM kairo_schema_migrations`,
  [],
);
const appliedMigrations = new Set(appliedRows.map((row) => row.migrationName));
const migrationsDirectory = new URL("../db/", import.meta.url);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();
let appliedStatements = 0;

for (const migrationFile of migrationFiles) {
  if (appliedMigrations.has(migrationFile)) continue;
  const migration = await readFile(new URL(migrationFile, migrationsDirectory), "utf8");
  const statements = migration
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement, []);
    appliedStatements += 1;
  }
  await sql.query(
    `INSERT INTO kairo_schema_migrations (migration_name)
     VALUES ($1)
     ON CONFLICT (migration_name) DO NOTHING`,
    [migrationFile],
  );
}

console.log(`Applied ${appliedStatements} statements from pending migrations.`);
