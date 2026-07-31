import { spawn } from "node:child_process";

if (process.env.VERCEL_ENV === "production") {
  console.log("Production build detected; applying pending database migrations.");
  await import("./migrate.mjs");
  await import("./run-data-migrations.mjs");
} else {
  console.log(`Skipping production migrations for ${process.env.VERCEL_ENV ?? "local"} build.`);
}

const exitCode = await new Promise((resolve, reject) => {
  const build = spawn("next", ["build"], {
    env: process.env,
    stdio: "inherit",
  });
  build.once("error", reject);
  build.once("exit", (code, signal) => {
    if (signal) reject(new Error(`Next.js build terminated by ${signal}`));
    else resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
