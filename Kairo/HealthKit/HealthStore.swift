import Foundation
import HealthKit

@MainActor
final class HealthStore: ObservableObject {
    @Published private(set) var authorizationState: HealthAuthorizationState = .notRequested
    @Published private(set) var snapshot = HealthSnapshot.empty
    @Published private(set) var isRefreshing = false
    @Published private(set) var collectionStatus = HealthCollectionStatus()
    @Published private(set) var syncStatus: HealthSyncStatus = .notConfigured
    @Published private(set) var isSyncConfigured = false

    private let store = HKHealthStore()
    private let syncConfigurationStore = HealthSyncConfigurationStore()
    private lazy var collector = try? HealthIncrementalCollector(store: store)
    private lazy var uploadClient = HealthUploadClient(configurationStore: syncConfigurationStore)
    private var observerQueries: [HKObserverQuery] = []

    init() {
        isSyncConfigured = (try? syncConfigurationStore.load()) != nil
        syncStatus = isSyncConfigured ? .ready : .notConfigured
    }

    func prepare() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationState = .unavailable
            return
        }

        do {
            let status = try await authorizationRequestStatus()
            authorizationState = status == .shouldRequest ? .notRequested : .requested

            guard authorizationState == .requested else {
                return
            }

            startObservers()
            await refresh()
        } catch {
            authorizationState = .failed(error.localizedDescription)
        }
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationState = .unavailable
            return
        }

        authorizationState = .requesting

        do {
            try await store.requestAuthorization(toShare: [], read: HealthDataCatalog.readTypes)
            authorizationState = .requested
            startObservers()
            await refresh()
        } catch {
            authorizationState = .failed(error.localizedDescription)
        }
    }

    func refresh() async {
        guard authorizationState == .requested, !isRefreshing else {
            return
        }

        isRefreshing = true
        defer { isRefreshing = false }

        let loader = HealthSnapshotLoader(store: store)

        do {
            snapshot = try await loader.load()
            if let collector {
                collectionStatus = await collector.collect()
                await uploadQueuedChanges()
            } else {
                collectionStatus.message = "Local protected storage could not be opened"
                collectionStatus.failedTypes = 1
            }
        } catch {
            authorizationState = .failed(error.localizedDescription)
        }
    }

    func pairPrivateLedger(using pairingCode: String) async throws {
        let configuration = try HealthSyncConfiguration(pairingCode: pairingCode)
        try syncConfigurationStore.save(configuration)
        isSyncConfigured = true
        syncStatus = .ready
        await uploadQueuedChanges()
    }

    func uploadQueuedChanges() async {
        guard isSyncConfigured, let collector else {
            syncStatus = .notConfigured
            return
        }
        syncStatus = .uploading(sent: 0)
        do {
            let result = try await uploadClient.uploadAll(from: collector)
            collectionStatus.queuedChanges = result.remaining
            syncStatus = .synced(date: Date(), sent: result.sent)
        } catch {
            collectionStatus.queuedChanges = collector.queuedChangeCount
            syncStatus = .failed(error.localizedDescription)
        }
    }

    private func authorizationRequestStatus() async throws -> HKAuthorizationRequestStatus {
        try await withCheckedThrowingContinuation { continuation in
            store.getRequestStatusForAuthorization(toShare: [], read: HealthDataCatalog.readTypes) { status, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: status)
                }
            }
        }
    }

    private func startObservers() {
        guard observerQueries.isEmpty else {
            return
        }

        for registration in Self.observerRegistrations {
            let query = HKObserverQuery(sampleType: registration.type, predicate: nil) {
                [weak self] _, completion, error in
                guard error == nil else {
                    completion()
                    return
                }

                let delivery = ObserverDeliveryCompletion(completion)
                Task { @MainActor [weak self] in
                    await self?.refresh()
                    delivery.call()
                }
            }

            observerQueries.append(query)
            store.execute(query)
            store.enableBackgroundDelivery(
                for: registration.type,
                frequency: registration.frequency
            ) { _, _ in }
        }
    }

    private static let quantityTypes: [HKQuantityTypeIdentifier] = [
        .bodyMass,
        .heartRate,
        .restingHeartRate,
        .heartRateVariabilitySDNN,
        .activeEnergyBurned,
        .appleExerciseTime,
        .appleStandTime,
    ]

    private static var observerRegistrations: [(type: HKSampleType, frequency: HKUpdateFrequency)] {
        let immediateIdentifiers: [HKQuantityTypeIdentifier] = [
            .bodyMass,
            .restingHeartRate,
        ]

        let hourlyIdentifiers: [HKQuantityTypeIdentifier] = [
            .heartRate,
            .heartRateVariabilitySDNN,
            .activeEnergyBurned,
            .appleExerciseTime,
            .appleStandTime,
        ]

        var registrations: [(type: HKSampleType, frequency: HKUpdateFrequency)] =
            immediateIdentifiers.compactMap {
                guard let type = HKObjectType.quantityType(forIdentifier: $0) else {
                    return nil
                }
                return (type, HKUpdateFrequency.immediate)
            }

        registrations += hourlyIdentifiers.compactMap {
            guard let type = HKObjectType.quantityType(forIdentifier: $0) else {
                return nil
            }
            return (type, HKUpdateFrequency.hourly)
        }

        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            registrations.append((sleep, HKUpdateFrequency.immediate))
        }

        registrations.append((HKObjectType.workoutType(), HKUpdateFrequency.immediate))
        registrations.append((HKObjectType.stateOfMindType(), HKUpdateFrequency.immediate))
        return registrations
    }
}

private final class ObserverDeliveryCompletion: @unchecked Sendable {
    private let completion: () -> Void

    init(_ completion: @escaping () -> Void) {
        self.completion = completion
    }

    func call() {
        completion()
    }
}
