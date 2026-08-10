# Kairo

Kairo is a private life assistant that turns personal signals into useful context. This single repository contains both the native iPhone Health Bridge and the Vercel web platform that receives, stores, and explains its signals.

## Repository layout

- `Kairo/` — SwiftUI iPhone app and HealthKit bridge
- `KairoTests/` — iOS unit tests
- `web/` — statically rendered Next.js interface, private Health Ledger API, Neon schema, and Vercel configuration
- `docs/` — product and implementation documentation

## First milestone

The current app:

- requests fine-grained read access to Apple Health;
- offers the complete standard HealthKit read catalog available on the device;
- displays mood, sleep, rings, weight, heart rate, resting heart rate, and HRV;
- refreshes when HealthKit reports relevant changes;
- batches high-volume signals using hourly background delivery;
- incrementally reconciles every authorized HealthKit sample stream;
- normalizes values, units, source apps, devices, metadata, and deletions;
- persists changes in a deduplicated queue protected by iOS Data Protection;
- supports manual reconciliation with pull-to-refresh;
- securely pairs with the private Kairo Health Ledger;
- safely replaces a ledger connection and resets replay cursors without deleting HealthKit data;
- uploads idempotent batches only over HTTPS and removes local changes only after acknowledgement;
- stores the endpoint credentials in the iPhone Keychain;
- keeps collecting safely offline and resumes upload on the next HealthKit event or manual refresh;
- imports pre-Kairo history in resumable 250-change pages without allowing the protected queue to grow unbounded.
- imports iOS 26 medication dose events and the user-annotated medication catalog;
- optionally captures Screen Time summaries, coarse location visits, and Apple Music recents;
- enriches current coarse location with Open-Meteo weather and air quality;
- derives travel, recurring-route commute, and routine-deviation features on the server;
- incrementally synchronizes Google Calendar into the separate context ledger;
- rebuilds affected health intelligence days automatically after acknowledged ingestion.

## Requirements

- Xcode 26 or newer
- iOS 18 or newer
- A paid Apple Developer Program team
- A physical iPhone for HealthKit background-delivery testing

## Run on an iPhone

1. Generate the project:

   ```sh
   xcodegen generate
   ```

2. Open `Kairo.xcodeproj`.
3. Select the `Kairo` target and choose your Apple Developer team under Signing & Capabilities.
4. Confirm that HealthKit, Background Delivery, Family Controls, and App & Website
   Activity appear under Signing & Capabilities. Apple may require approval for the
   Family Controls distribution entitlement before an archive can be distributed.
5. Select your connected iPhone and run the app.
6. Tap **Choose health signals** and approve only the categories you want Kairo to read.
7. Tap **Pair private ledger**, paste the private pairing code, then tap **Pair and upload**.

HealthKit intentionally does not reveal whether an individual read permission was denied. Kairo therefore displays unavailable data as “No data” without claiming that permission was denied.

The standard catalog currently declares 205 directly readable object types. On the installed SDK, 196 resolve to sample streams that support anchored incremental collection. The exact available count is computed at runtime because SDK and OS support differ. Characteristics and activity summaries use separate query APIs and remain visible through the curated snapshot until their dedicated collectors are added. Clinical records remain outside Kairo. On iOS 26, medication dose events and the user-annotated medication catalog are included in the HealthKit authorization request; older systems simply omit those unavailable types. Dashboard cards stay curated even when broader collection is authorized.

The first collection seeds the preceding 24 hours, then opaque HealthKit anchors fetch only additions, updates, and deletions. A separate historical cursor walks records before that live cutoff. It protects one 250-change page locally, waits for server acknowledgement, and then continues, so a large archive cannot fill the phone. The queue has a 25,000-change safety limit and refuses new changes instead of silently dropping data. A failed or interrupted request leaves the complete batch on the phone for retry, while historical stream progress resumes after the last protected page.

## Synchronization model

Kairo is event-driven rather than cron-driven. Every collectible HealthKit sample stream gets a background observer, subject to iOS scheduling. Weight, sleep, workouts, mood, glucose, oxygen saturation, temperature, inhaler use, resting heart rate, and HRV request immediate delivery; the remaining streams request power-efficient hourly delivery. An observer reconciles only the changed stream before uploading. Opening the app or pulling to refresh performs a complete reconciliation and uploads immediately.

The web ledger is private to its owner and exposes a live dashboard at `/health`. The dashboard refreshes every ten seconds while open. Health data is keyed by HealthKit sample UUID and device ID so repeated delivery is safe.

Non-health context stays in a separate ledger. Screen Time requires iOS 26.4 and the
App & Website Activity data-access authorization; Apple currently limits customer
data-access approval to EU devices/accounts, while development provisioning can test
in other regions. Location stores only coordinates
rounded to two decimal places (roughly kilometre-scale cells), not a continuous GPS
trail. Commute minutes appear only after the same weekday route has occurred on at
least three distinct days; routine deviation needs three earlier matching weekdays.
Apple Music supplies recently played items and their last-played timestamps, not a
complete play-by-play listening export.

All browser pages are generated as static assets. Authentication, HealthKit ingestion, and private summary reads use Vercel serverless routes; page navigation never waits for request-time SSR.

## Run the web app

```sh
cd web
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

The Vercel project must use `web` as its Root Directory. Complete Neon, environment-variable, domain, and pairing instructions are in [`web/README.md`](web/README.md).

## Validate

```sh
xcodegen generate
xcodebuild test \
  -project Kairo.xcodeproj \
  -scheme Kairo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Background delivery must be tested on a physical device.

Validate the web app separately:

```sh
cd web
npm test
npm run lint
```

## Health intelligence foundation

Kairo now keeps the raw HealthKit ledger separate from a rebuildable intelligence layer: canonical signal definitions, wake-day sleep episodes, personal-day features, trailing baselines, compact daily profiles, learned-factor storage, and owner-authenticated AI context APIs. The model and safety rules are documented in [`docs/intelligence-architecture.md`](docs/intelligence-architecture.md), with feature definitions in [`docs/health-feature-catalog.md`](docs/health-feature-catalog.md) and the assistant presentation contract in [`docs/jarvis-health-view-model.md`](docs/jarvis-health-view-model.md).

Build or rebuild derived health data without resyncing the raw ledger:

```sh
cd web
npm run db:migrate
npm run features:rebuild
npm run factors:train
```

Each acknowledged HealthKit upload now schedules a post-response rebuild for the
affected personal days and their rolling-baseline horizon. The raw ledger remains the
source of truth; this is materialization of data Kairo already received, not another
iPhone data source. Temporally validated factor training remains intentionally separate
until Kairo has enough State of Mind labels.

Context setup, Google OAuth variables, and source limitations are documented in
[`docs/context-sources.md`](docs/context-sources.md).
