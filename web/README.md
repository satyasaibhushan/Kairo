# Kairo Life OS

The Vercel-ready home of Kairo at `kairo.bhushan.fun`. It contains the public
Life OS vision, an owner-only live Health Ledger at `/health`, and the
device-authenticated ingestion endpoint used by the Kairo iPhone app.

## Architecture

- Next.js App Router on Vercel
- statically generated browser pages with no request-time SSR
- Neon Postgres for durable HealthKit records
- bearer-token authentication for iPhone uploads
- signed, HTTP-only owner sessions for the health dashboard
- idempotent batches and HealthKit sample upserts
- versioned daily health features and compact owner-authenticated AI context APIs

## Local setup

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Set every value in `.env.local`. Generate secrets with a password manager or
`openssl rand -hex 32`; never commit them. The dashboard password must be at
least 8 characters, while the session secret must be at least 32 characters.

## Deploy to Vercel

1. Push this repository to GitHub and import it as a Vercel project.
2. In the Vercel project, install the Neon integration and connect a database
   in a region near `sin1`. The integration supplies `DATABASE_URL`.
3. Add these Production, Preview, and Development environment variables:
   `KAIRO_INGEST_TOKEN`, `KAIRO_OWNER_ID`, `KAIRO_OWNER_NAME`,
   `KAIRO_DASHBOARD_PASSWORD`, and `KAIRO_SESSION_SECRET`.
4. Pull the Vercel environment locally and initialize the database:

   ```bash
   vercel env pull .env.local
   npm run db:migrate
   ```

5. Deploy. In Vercel **Settings → Domains**, add `kairo.bhushan.fun` and copy
   the exact CNAME target Vercel shows into the DNS provider for `bhushan.fun`.
6. After HTTPS is active, generate the iPhone pairing code using the same
   ingestion token configured in Vercel:

   ```bash
   KAIRO_INGEST_TOKEN='your-token' npm run pairing-code
   ```

7. On an unpaired Kairo install, choose **Pair private ledger**, paste that
   output, and upload. An already-paired phone needs the connection-replacement
   control before cutover; do not delete or overwrite its current ledger state.

### Cut over from the Sites ledger

Do not switch the iPhone until Neon is migrated and the Vercel ingestion check
passes. Records already acknowledged by the old ledger are no longer in the
phone queue. For the current prototype, the safest cutover is to replay them
from Apple Health after pairing the Vercel endpoint; Kairo's separate history
cursor makes that replay resumable and the new ledger remains idempotent.

## Health API

`POST /api/health/changes` accepts up to 250 changes and 1 MB per request. It
requires `Authorization: Bearer <KAIRO_INGEST_TOKEN>`. Batch IDs and HealthKit
sample IDs make retries safe; records are acknowledged only after the database
commit succeeds.

The browser receives static HTML for `/`, `/login`, and `/health`. Login and
health data load through small serverless API calls after the page is already
interactive. `GET /api/health/summary` still verifies the signed owner session
before returning any private data.

## Build the intelligence layer

The raw ledger remains immutable and replayable. Migrations add a current-observation view, canonical signal catalog, daily features and profiles, factor scores, and evidence-backed insights. Rebuilds replace only derived rows for the requested range and calculation version.

```bash
npm run db:migrate
npm run features:rebuild
npm run factors:train
```

Optional rebuild arguments are `--owner`, `--timezone`, `--from`, and `--through`. The read-only owner endpoints are:

- `GET /api/health/intelligence/day?date=YYYY-MM-DD`
- `GET /api/health/intelligence/trend?feature=<key>&from=YYYY-MM-DD&through=YYYY-MM-DD`
- `GET /api/health/intelligence/context?date=YYYY-MM-DD&days=28`
- `GET /api/health/intelligence/catalog`

These are the bounded evidence surfaces intended for the future assistant. They do not expose arbitrary SQL or unrestricted raw HealthKit data.

## Validation

```bash
npm test
```
