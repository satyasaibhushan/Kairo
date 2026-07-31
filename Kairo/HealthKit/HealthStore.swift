import Foundation
import HealthKit

@MainActor
final class HealthStore: ObservableObject {
    @Published private(set) var authorizationState: HealthAuthorizationState = .notRequested
    @Published private(set) var snapshot = HealthSnapshot.empty
    @Published private(set) var isRefreshing = false

    private let store = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []

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
        } catch {
            authorizationState = .failed(error.localizedDescription)
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

                completion()

                Task { @MainActor [weak self] in
                    await self?.refresh()
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
