# Kairo

Kairo is a private life assistant that turns personal signals into useful context. This repository starts with the iPhone Health Bridge: a native SwiftUI app that reads user-approved Apple Health data and prepares it for event-driven synchronization with the Kairo platform.

## First milestone

The current app:

- requests fine-grained read access to Apple Health;
- offers the complete standard HealthKit read catalog available on the device;
- displays mood, sleep, rings, weight, heart rate, resting heart rate, and HRV;
- refreshes when HealthKit reports relevant changes;
- batches high-volume signals using hourly background delivery;
- supports manual reconciliation with pull-to-refresh;
- keeps all processing on-device until a Kairo API is configured.

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

HealthKit intentionally does not reveal whether an individual read permission was denied. Kairo therefore displays unavailable data as “No data” without claiming that permission was denied.

The standard catalog currently declares 205 directly readable object types from the installed SDK. Clinical records and iOS 26 medication objects use additional authorization systems and remain separate, explicit opt-ins. Dashboard cards stay curated even when broader collection is authorized.

## Validate

```sh
xcodegen generate
xcodebuild test \
  -project Kairo.xcodeproj \
  -scheme Kairo \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

Background delivery must be tested on a physical device.

## Next milestone

The next slice adds the authenticated Kairo sync API, anchored incremental queries, durable offline uploads, and UUID-based deduplication. HealthKit anchors will advance only after the server acknowledges each batch.
