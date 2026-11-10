import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

export async function testDatabase() {
  const db = new PGlite();
  for (const name of ["001_initial", "002_health_intelligence", "003_context_sources"]) {
    await db.exec(await readFile(new URL(`../../db/${name}.sql`, import.meta.url), "utf8"));
  }
  return db;
}
