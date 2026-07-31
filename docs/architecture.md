# Health Bridge architecture

## Runtime flow

1. HealthKit saves or deletes a selected sample.
2. An `HKObserverQuery` wakes Kairo.
3. Kairo refreshes the curated snapshot and reconciles all sample streams.
4. Each `HKAnchoredObjectQuery` returns additions, updates, deletions, and a new opaque anchor.
5. Normalized changes enter a UUID-deduplicated local queue protected by iOS Data Protection.
6. Only after the queue is durably written does Kairo persist that type's new anchor.
7. The future Kairo API accepts and acknowledges idempotent upload batches.
8. Acknowledged changes leave the local queue and the web dashboard receives a live update.

## Delivery policy

Low-volume signals use immediate background delivery:

- mood
- weight
- sleep
- workouts
- resting heart rate

High-volume signals use hourly delivery:

- heart rate
- HRV
- active energy
- exercise time
- stand time

Foreground launch and pull-to-refresh always perform a full dashboard reconciliation. A scheduled background task may later provide a safety net, but it is not treated as cron or as the primary ingestion path.

The first anchored query for each sample type is limited to the preceding 24 hours. Later queries use the stored anchor and fetch only changes. This is a deliberate pre-server safety boundary: the authenticated API will add paged, acknowledged historical backfill without risking unbounded local storage.

## Privacy boundary

HealthKit access and raw-sample normalization happen on the iPhone. The app requests read access only. Raw health data will not be sent to analytics SDKs or an AI provider. Any future model integration must have a separate, explicit consent boundary and should default to daily derived features rather than raw samples.
