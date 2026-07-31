# Health Bridge architecture

## Runtime flow

1. HealthKit saves or deletes a selected sample.
2. An `HKObserverQuery` wakes Kairo.
3. Kairo refreshes the on-device snapshot.
4. The upcoming sync layer runs an anchored query for the changed type.
5. New and deleted records enter an encrypted local upload queue.
6. The Kairo API acknowledges an idempotent batch.
7. Only then does the app persist the new HealthKit anchor.
8. The web dashboard receives a server-side live update.

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

## Privacy boundary

HealthKit access and raw-sample normalization happen on the iPhone. The app requests read access only. Raw health data will not be sent to analytics SDKs or an AI provider. Any future model integration must have a separate, explicit consent boundary and should default to daily derived features rather than raw samples.
