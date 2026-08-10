# Context sources

Kairo stores non-HealthKit context in `context_observations`, then rebuilds versioned
`context_daily_features` and `context_daily_profiles`. Missing observations stay
unknown; no collector writes zero as a substitute for missing permission or delivery.
The bounded health-intelligence context endpoint joins these compact profiles into the
assistant envelope without exposing unrestricted raw context rows.

## iPhone sources

### Screen Time

On iOS 26.4 or later, Kairo requests individual Family Controls authorization with
App & Website Activity data access. It uploads daily total duration, longest session,
first pickup, pickup count, notification count, and the largest category durations.
It deliberately does not upload application identifiers.

The App ID and provisioning profile must contain both Family Controls entitlements in
`Kairo/Resources/Kairo.entitlements`. Apple permits development testing with its
data-access provisioning profile in all regions, but customer installations can receive
`approvedWithDataAccess` only for EU devices signed into an EU Apple Account. Basic
Family Controls approval is not treated as if detailed Screen Time data were available.

### Location

Core Location visit monitoring produces arrival/departure intervals plus coordinates
rounded to two decimal places. A current coarse snapshot is requested on refresh.
Kairo derives:

- visited time, visit count, and distinct coarse places;
- travel time and approximate distance between visits;
- commute time for routes repeated on at least three distinct weekdays in 42 days;
- deviation from the owner’s earlier departure time for the same weekday.

Visit monitoring begins after permission is granted; iOS does not expose a historical
archive of visits from before Kairo began monitoring.

### Apple Music

MusicKit recently played items contribute title, artist, album, genre, duration,
play count, and last-played time when Apple supplies them. This is useful listening
context but is not a complete event history, and Kairo does not infer mood from taste.

For paired devices, Kairo fetches a developer token from the authenticated
`/api/context/apple-music/developer-token` route. The server signs a 30-day ES256 token;
the Media Services private key never enters the iPhone app or API response. MusicKit
continues to obtain and manage the owner-specific Music User Token.

In Apple Developer, register a Media ID with MusicKit enabled, then create a **Media
Services** key associated with that Media ID. Download its `.p8` file once and configure
these Vercel environment variables:

```text
APPLE_MUSIC_TEAM_ID=NPJKKT52N4
APPLE_MUSIC_KEY_ID=...
APPLE_MUSIC_PRIVATE_KEY_BASE64=...
```

Encode the downloaded key without printing it to the terminal history:

```bash
base64 < AuthKey_KEY_ID.p8 | tr -d '\n'
```

Paste the result directly into Vercel. Never commit the `.p8` file or its encoded value.

### Medication

On iOS 26 or later, medication dose events enter the HealthKit ledger with dose,
unit, schedule/log status, and a stable medication concept key. The annotated
medication catalog is represented as synthetic inventory observations so names,
forms, schedules, and codings can be reconciled without using clinical records.

## Server sources

### Weather

When a fresh location observation arrives, Kairo calls Open-Meteo for current
temperature, apparent temperature, humidity, precipitation, UV, US AQI, and PM2.5.
Weather failure never blocks iPhone ingestion or context materialization. Pollen is
not stored because Open-Meteo’s pollen coverage is Europe-only and missing must not
be represented as zero.

### Google Calendar

The owner-authenticated `POST /api/context/google-calendar/sync` route performs an
on-demand sync. Vercel also calls the same route daily through a `CRON_SECRET`-secured
GET. Google sync tokens make subsequent runs incremental; an expired token causes a
bounded 120-day full refresh.

Kairo's Health dashboard provides **Connect Google Calendar**, **Sync now**, and
**Disconnect** controls. Connect uses a signed, ten-minute anti-CSRF state and requests
read-only Calendar access. The returned refresh token is encrypted with AES-256-GCM
before it is stored in `google_calendar_connections`; neither status APIs nor the UI
return it. Disconnect asks Google to revoke the token, removes the local connection and
imported Calendar observations, then rebuilds the affected context days.

Create a Google OAuth **Web application** client and register this exact authorized
redirect URI:

```text
https://YOUR_KAIRO_DOMAIN/api/context/google-calendar/callback
```

Configure these values in Vercel and `.env.local`:

```text
KAIRO_PUBLIC_URL=https://YOUR_KAIRO_DOMAIN
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
GOOGLE_CALENDAR_REDIRECT_URI=https://YOUR_KAIRO_DOMAIN/api/context/google-calendar/callback
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=...
CRON_SECRET=...
```

Generate the independent token-encryption key once with `openssl rand -base64 32` and
keep the same value across deployments. If Google's OAuth consent screen is in Testing,
add the Kairo owner's Google account as a test user. No manually generated refresh token
is required.

Calendar events contribute event duration, title, all-day status, event type,
transparency, recurrence, attendee count, and the owner’s response status.

## Database and deployment

Apply `web/db/003_context_sources.sql` before pairing a device to the context endpoint.
Production builds run numbered migrations automatically. The iPhone derives
`/api/context/observations` from the paired health endpoint, so an existing pairing
does not need a second token.
