import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL before running data migrations");

const sql = neon(databaseUrl);
await sql.query(
  `CREATE TABLE IF NOT EXISTS kairo_data_migrations (
     migration_name text PRIMARY KEY,
     status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
     started_at timestamptz NOT NULL DEFAULT now(),
     completed_at timestamptz,
     error_message text
   )`,
  [],
);

const migrations = [
  {
    name: "001_health_v1_features_and_factors",
    run: async () => {
      await import("./rebuild-health-features.mjs");
      await import("./train-health-factors.mjs");
    },
  },
];

for (const migration of migrations) {
  const completedRows = await sql.query(
    `SELECT 1
     FROM kairo_data_migrations
     WHERE migration_name = $1 AND status = 'completed'
     LIMIT 1`,
    [migration.name],
  );
  if (completedRows.length > 0) {
    console.log(`Data migration ${migration.name} already completed; skipping.`);
    continue;
  }

  await sql.query(
    `INSERT INTO kairo_data_migrations (
       migration_name, status, started_at, completed_at, error_message
     ) VALUES ($1, 'running', now(), NULL, NULL)
     ON CONFLICT (migration_name) DO UPDATE SET
       status = 'running',
       started_at = now(),
       completed_at = NULL,
       error_message = NULL`,
    [migration.name],
  );

  try {
    console.log(`Running data migration ${migration.name}.`);
    await migration.run();
    await sql.query(
      `UPDATE kairo_data_migrations
       SET status = 'completed', completed_at = now()
       WHERE migration_name = $1`,
      [migration.name],
    );
    console.log(`Completed data migration ${migration.name}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql.query(
      `UPDATE kairo_data_migrations
       SET status = 'failed', completed_at = now(), error_message = $2
       WHERE migration_name = $1`,
      [migration.name, message.slice(0, 2_000)],
    );
    throw error;
  }
}
