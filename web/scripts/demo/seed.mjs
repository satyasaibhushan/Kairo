// Seeds the local demo ledger through the app's own ingest endpoint, exactly as the iPhone bridge does:
// idempotent batches of fictional HealthKit changes for the last 14 days, acknowledged by the API, which
// then rebuilds the derived daily features. Every value here is invented.
//   KAIRO_INGEST_TOKEN=... node scripts/demo/seed.mjs [http://localhost:3100]
const base = process.argv[2] ?? "http://localhost:3100";
const token = process.env.KAIRO_INGEST_TOKEN;
if (!token) throw new Error("Set KAIRO_INGEST_TOKEN to the value in .env.local");

const DEVICE = "demo-iphone-0001";
const DAYS = 14;
// Small deterministic generator so reruns produce the same ledger.
let state = 20261022;
const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
const between = (lo, hi) => lo + rand() * (hi - lo);
const round = (n, p = 0) => Number(n.toFixed(p));

const now = Date.now();
const dayStart = (daysAgo, hour = 0, minute = 0) => {
  const d = new Date(now - daysAgo * 86400000);
  d.setUTCHours(hour - 5, minute - 30, 0, 0); // IST wall-clock expressed in UTC
  return d;
};
const iso = (d) => d.toISOString();
const sample = (typeIdentifier, start, end, fields, seq) => start.getTime() > now ? null : ({
  id: `evt-${typeIdentifier}-${seq}`,
  operation: "upsert",
  sampleID: `demo-${typeIdentifier.replace(/[^A-Za-z]/g, "").toLowerCase().slice(-24)}-${seq}`,
  typeIdentifier,
  startDate: iso(start),
  endDate: iso(end),
  numericValue: null,
  unit: null,
  categoryValue: null,
  sourceName: "Apple Watch",
  sourceBundleIdentifier: "com.apple.health",
  sourceVersion: "26.0",
  deviceName: "Apple Watch",
  deviceModel: "Watch",
  deviceManufacturer: "Apple Inc.",
  metadata: {},
  ...fields,
});

// Nothing is dated after "now" in the owner's time zone, so today's ledger reads as still arriving.
const nowHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
const changes = [];
let seq = 0;
for (let d = DAYS - 1; d >= 0; d -= 1) {
  const weekend = [0, 6].includes(dayStart(d).getUTCDay());
  // Sleep: previous night, 22:50 to 06:30 with some variation; category 1 = asleep (unspecified).
  const bed = dayStart(d + 1, 22, round(between(30, 70)));
  const wake = dayStart(d, 6, round(between(10, 50)));
  changes.push(sample("HKCategoryTypeIdentifierSleepAnalysis", bed, wake, { categoryValue: 1, sourceName: "iPhone", deviceName: "iPhone" }, seq++));
  // Steps as hourly buckets through the waking day.
  for (let h = 7; h < 22; h += 1) {
    if (d === 0 && h >= nowHour) break;
    const burst = (h === 7 || h === 18) && !weekend ? between(1200, 2600) : between(60, 700);
    changes.push(sample("HKQuantityTypeIdentifierStepCount", dayStart(d, h), dayStart(d, h, 59), { numericValue: round(burst), unit: "count" }, seq++));
  }
  // Heart rate every two hours, resting heart rate and HRV once a day.
  for (let h = 6; h < 23; h += 2)
    if (d > 0 || h < nowHour) changes.push(sample("HKQuantityTypeIdentifierHeartRate", dayStart(d, h, 5), dayStart(d, h, 5), { numericValue: round(between(58, 104)), unit: "count/min" }, seq++));
  changes.push(sample("HKQuantityTypeIdentifierRestingHeartRate", dayStart(d, 5), dayStart(d, 5), { numericValue: round(between(54, 61)), unit: "count/min" }, seq++));
  changes.push(sample("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", dayStart(d, 5, 30), dayStart(d, 5, 30), { numericValue: round(between(38, 72), 1), unit: "ms" }, seq++));
  changes.push(sample("HKQuantityTypeIdentifierActiveEnergyBurned", dayStart(d, 7), dayStart(d, 22), { numericValue: round(between(320, 640)), unit: "kcal" }, seq++));
  changes.push(sample("HKQuantityTypeIdentifierAppleExerciseTime", dayStart(d, 7), dayStart(d, 22), { numericValue: round(weekend ? between(10, 40) : between(25, 55)), unit: "min" }, seq++));
  if (d % 3 === 0)
    changes.push(sample("HKQuantityTypeIdentifierBodyMass", dayStart(d, 6, 40), dayStart(d, 6, 40), { numericValue: round(between(67.2, 68.4), 1), unit: "kg", sourceName: "Health", deviceName: "iPhone" }, seq++));
  // One State of Mind check-in in the evening.
  const valence = round(between(-0.4, 0.8), 2);
  changes.push(sample("HKStateOfMindTypeIdentifier", dayStart(d, 21, 15), dayStart(d, 21, 15), {
    numericValue: valence, unit: null, sourceName: "Health", deviceName: "iPhone",
    metadata: { kind: "dailyMood", valenceClassification: valence > 0.3 ? "pleasant" : valence < -0.1 ? "slightlyUnpleasant" : "neutral", labels: valence > 0.3 ? "content,calm" : "tired", associations: weekend ? "family" : "work" },
  }, seq++));
}

// The bridge uploads at most 250 changes per batch; each batch id is stable so reruns are idempotent.
const pending = changes.filter(Boolean);
let accepted = 0;
for (let i = 0; i < pending.length; i += 250) {
  const batchIndex = i / 250;
  const response = await fetch(`${base}/api/health/changes`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ batchId: `demo-batch-${String(batchIndex).padStart(3, "0")}`, deviceId: DEVICE, sentAt: iso(new Date(now - (pending.length - i) * 1000)), changes: pending.slice(i, i + 250) }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`batch ${batchIndex} -> ${response.status} ${JSON.stringify(json)}`);
  accepted += json.accepted ?? json.acceptedCount ?? 0;
}
console.log(`sent ${pending.length} fictional changes in ${Math.ceil(pending.length / 250)} batches; accepted ${accepted}`);
