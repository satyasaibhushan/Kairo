import Foundation
import HealthKit

struct HealthSnapshotLoader {
    let store: HKHealthStore

    func load(now: Date = .now) async throws -> HealthSnapshot {
        async let mood = latestMood()
        async let sleep = latestSleep(now: now)
        async let weight = latestQuantity(
            metric: .weight,
            identifier: .bodyMass,
            unit: .gramUnit(with: .kilo),
            unitLabel: "kg",
            fractionDigits: 1
        )
        async let heartRate = latestQuantity(
            metric: .heartRate,
            identifier: .heartRate,
            unit: .count().unitDivided(by: .minute()),
            unitLabel: "bpm",
            fractionDigits: 0
        )
        async let restingHeartRate = latestQuantity(
            metric: .restingHeartRate,
            identifier: .restingHeartRate,
            unit: .count().unitDivided(by: .minute()),
            unitLabel: "bpm",
            fractionDigits: 0
        )
        async let heartRateVariability = latestQuantity(
            metric: .heartRateVariability,
            identifier: .heartRateVariabilitySDNN,
            unit: .secondUnit(with: .milli),
            unitLabel: "ms",
            fractionDigits: 0
        )
        async let activity = activityReadings(now: now)

        let activityValues = try await activity
        let readings = [
            try await mood,
            try await sleep,
            activityValues.move,
            activityValues.exercise,
            activityValues.stand,
            try await weight,
            try await heartRate,
            try await restingHeartRate,
            try await heartRateVariability,
        ]

        return HealthSnapshot(readings: readings, refreshedAt: now)
    }

    private func latestQuantity(
        metric: HealthMetric,
        identifier: HKQuantityTypeIdentifier,
        unit: HKUnit,
        unitLabel: String,
        fractionDigits: Int
    ) async throws -> HealthReading {
        guard let type = HKObjectType.quantityType(forIdentifier: identifier) else {
            return .unavailable(metric)
        }

        let samples = try await samples(
            type: type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        )

        guard let sample = samples.first as? HKQuantitySample else {
            return .unavailable(metric)
        }

        let number = sample.quantity.doubleValue(for: unit)
        return HealthReading(
            metric: metric,
            value: number.formatted(.number.precision(.fractionLength(fractionDigits))),
            unit: unitLabel,
            measuredAt: sample.endDate
        )
    }

    private func latestMood() async throws -> HealthReading {
        let type = HKObjectType.stateOfMindType()
        let samples = try await samples(
            type: type,
            predicate: nil,
            limit: 1,
            sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]
        )

        guard let sample = samples.first as? HKStateOfMind else {
            return .unavailable(.mood)
        }

        return HealthReading(
            metric: .mood,
            value: sample.valence.formatted(
                .number
                    .sign(strategy: .always())
                    .precision(.fractionLength(2))
            ),
            unit: "valence",
            measuredAt: sample.endDate
        )
    }

    private func latestSleep(now: Date) async throws -> HealthReading {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            return .unavailable(.sleep)
        }

        let start = Calendar.current.date(byAdding: .hour, value: -24, to: now) ?? now
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: now,
            options: [.strictStartDate]
        )
        let samples = try await samples(
            type: type,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        )

        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue,
        ]
        let asleep = samples
            .compactMap { $0 as? HKCategorySample }
            .filter { asleepValues.contains($0.value) }

        guard !asleep.isEmpty else {
            return .unavailable(.sleep)
        }

        let duration = asleep.reduce(0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
        let hours = duration / 3_600

        return HealthReading(
            metric: .sleep,
            value: hours.formatted(.number.precision(.fractionLength(1))),
            unit: "hours",
            measuredAt: asleep.map(\.endDate).max()
        )
    }

    private func activityReadings(now: Date) async throws -> (
        move: HealthReading,
        exercise: HealthReading,
        stand: HealthReading
    ) {
        var components = Calendar.current.dateComponents([.era, .year, .month, .day], from: now)
        components.calendar = .current
        let predicate = HKQuery.predicateForActivitySummary(with: components)

        let summaries = try await activitySummaries(predicate: predicate)
        guard let summary = summaries.first else {
            return (
                .unavailable(.move),
                .unavailable(.exercise),
                .unavailable(.stand)
            )
        }

        return (
            HealthReading(
                metric: .move,
                value: summary.activeEnergyBurned
                    .doubleValue(for: .kilocalorie())
                    .formatted(.number.precision(.fractionLength(0))),
                unit: "kcal",
                measuredAt: now
            ),
            HealthReading(
                metric: .exercise,
                value: summary.appleExerciseTime
                    .doubleValue(for: .minute())
                    .formatted(.number.precision(.fractionLength(0))),
                unit: "minutes",
                measuredAt: now
            ),
            HealthReading(
                metric: .stand,
                value: summary.appleStandHours
                    .doubleValue(for: .count())
                    .formatted(.number.precision(.fractionLength(0))),
                unit: "hours",
                measuredAt: now
            )
        )
    }

    private func samples(
        type: HKSampleType,
        predicate: NSPredicate?,
        limit: Int,
        sortDescriptors: [NSSortDescriptor]?
    ) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: limit,
                sortDescriptors: sortDescriptors
            ) { _, results, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: results ?? [])
                }
            }

            store.execute(query)
        }
    }

    private func activitySummaries(predicate: NSPredicate) async throws -> [HKActivitySummary] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKActivitySummaryQuery(predicate: predicate) { _, summaries, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: summaries ?? [])
                }
            }

            store.execute(query)
        }
    }
}
