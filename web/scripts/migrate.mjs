import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL before running npm run db:migrate");
}

const sql = neon(databaseUrl);
const migration = await readFile(new URL("../db/001_initial.sql", import.meta.url), "utf8");
const statements = migration
  .split(/;\s*(?:\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const statement of statements) {
  await sql.query(statement, []);
}

console.log(`Applied ${statements.length} Kairo database statements.`);
