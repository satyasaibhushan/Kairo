// Records the product demo into the repository's docs/demo/ against a running local build seeded by scripts/demo/seed.mjs:
//   poster.png (the live Health Ledger), demo.webm (recorded session), demo.mp4 and demo.gif (ffmpeg copies).
//   KAIRO_DASHBOARD_PASSWORD=... node scripts/demo/capture.mjs [http://localhost:3100]
// Playwright is not a project dependency: set PLAYWRIGHT_MODULE to its entry file. ffmpeg is optional.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3100";
const password = process.env.KAIRO_DASHBOARD_PASSWORD;
if (!password) throw new Error("Set KAIRO_DASHBOARD_PASSWORD to the value in .env.local");
const OUT = fileURLToPath(new URL("../../../docs/demo/", import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").then((m) => m.default ?? m);

const SIZE = { width: 1280, height: 800 };
mkdirSync(OUT, { recursive: true });
rmSync(`${OUT}frames`, { recursive: true, force: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: SIZE, timezoneId: "Asia/Kolkata", recordVideo: { dir: `${OUT}frames`, size: SIZE },
});
const page = await ctx.newPage();
const settle = (ms) => page.waitForTimeout(ms);
const glide = async (y, ms = 1400) => {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
  await settle(ms);
};
try {
  // Public landing, then the owner-only ledger behind its password.
  await page.goto(`${base}/`);
  await settle(2200);
  await page.goto(`${base}/login?returnTo=%2Fhealth`);
  await settle(900);
  await page.locator("input[type=password]").pressSequentially(password, { delay: 60 });
  await settle(400);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("**/health");
  await page.getByText("samples in ledger").waitFor();
  await settle(2200);
  await page.screenshot({ path: `${OUT}poster.png` });
  await glide(560, 1800);
  await glide(1150, 1800);
  await glide(1750, 2200);
} finally {
  await ctx.close();
  await browser.close();
}

const [webm] = readdirSync(`${OUT}frames`).filter((f) => f.endsWith(".webm"));
renameSync(`${OUT}frames/${webm}`, `${OUT}demo.webm`);
rmSync(`${OUT}frames`, { recursive: true, force: true });
console.log("wrote docs/demo/poster.png docs/demo/demo.webm");

const ffmpeg = (args) => spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
  console.log("ffmpeg not found: skipped docs/demo/demo.mp4 and docs/demo/demo.gif");
} else {
  ffmpeg(["-i", `${OUT}demo.webm`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", `${OUT}demo.mp4`]);
  ffmpeg(["-i", `${OUT}demo.webm`, "-vf", "fps=8,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=5", "-loop", "0", `${OUT}demo.gif`]);
  console.log("wrote docs/demo/demo.mp4 docs/demo/demo.gif");
}
