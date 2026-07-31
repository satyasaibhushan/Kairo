import { readdir, readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running npm run db:migrate");
}

const sql = neon(databaseUrl);
const migrationsDirectory = new URL("../db/", import.meta.url);
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort();
let appliedStatements = 0;

for (const migrationFile of migrationFiles) {
  const migration = await readFile(new URL(migrationFile, migrationsDirectory), "utf8");
  const statements = migration
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await sql.query(statement, []);
    appliedStatements += 1;
  }
}

console.log(`Applied ${appliedStatements} statements from ${migrationFiles.length} migrations.`);
