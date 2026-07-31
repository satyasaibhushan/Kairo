# Kairo

Kairo is a private life assistant that turns personal signals into useful context. This single repository contains both the native iPhone Health Bridge and the Vercel web platform that receives, stores, and explains its signals.

## Repository layout

- `Kairo/` — SwiftUI iPhone app and HealthKit bridge
- `KairoTests/` — iOS unit tests
- `web/` — Next.js web app, private Health Ledger API, Neon schema, and Vercel configuration
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
- uploads idempotent batches only over HTTPS and removes local changes only after acknowledgement;
- stores the endpoint credentials in the iPhone Keychain;
- keeps collecting safely offline and resumes upload on the next HealthKit event or manual refresh;
- imports pre-Kairo history in resumable 250-change pages without allowing the protected queue to grow unbounded.

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
4. Confirm that HealthKit and Background Delivery appear under Signing & Capabilities.
5. Select your connected iPhone and run the app.
6. Tap **Choose health signals** and approve only the categories you want Kairo to read.
7. Tap **Pair private ledger**, paste the private pairing code, then tap **Pair and upload**.

HealthKit intentionally does not reveal whether an individual read permission was denied. Kairo therefore displays unavailable data as “No data” without claiming that permission was denied.

The standard catalog currently declares 205 directly readable object types. On the installed SDK, 196 resolve to sample streams that support anchored incremental collection. The exact available count is computed at runtime because SDK and OS support differ. Characteristics and activity summaries use separate query APIs and remain visible through the curated snapshot until their dedicated collectors are added. Clinical records and iOS 26 medication objects use additional authorization systems and remain separate, explicit opt-ins. Dashboard cards stay curated even when broader collection is authorized.

The first collection seeds the preceding 24 hours, then opaque HealthKit anchors fetch only additions, updates, and deletions. A separate historical cursor walks records before that live cutoff. It protects one 250-change page locally, waits for server acknowledgement, and then continues, so a large archive cannot fill the phone. The queue has a 25,000-change safety limit and refuses new changes instead of silently dropping data. A failed or interrupted request leaves the complete batch on the phone for retry, while historical stream progress resumes after the last protected page.

## Synchronization model

Kairo is event-driven rather than cron-driven. Every collectible HealthKit sample stream gets a background observer, subject to iOS scheduling. Weight, sleep, workouts, mood, glucose, oxygen saturation, temperature, inhaler use, resting heart rate, and HRV request immediate delivery; the remaining streams request power-efficient hourly delivery. An observer reconciles only the changed stream before uploading. Opening the app or pulling to refresh performs a complete reconciliation and uploads immediately.

The web ledger is private to its owner and exposes a live dashboard at `/health`. The dashboard refreshes every ten seconds while open. Health data is keyed by HealthKit sample UUID and device ID so repeated delivery is safe.

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

## Next milestone

Use the complete ledger to compute daily features and learn which signals predict self-reported mood for this person. Medication and clinical-record sources remain separate explicit opt-ins because Apple gives them additional privacy and authorization semantics.
