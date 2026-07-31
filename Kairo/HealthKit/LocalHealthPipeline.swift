import CryptoKit
import Foundation
@preconcurrency import HealthKit

enum HealthChangeOperation: String, Codable {
    case upsert
    case delete
}

struct HealthChange: Codable, Identifiable, Equatable {
    let id: String
    let operation: HealthChangeOperation
    let sampleID: UUID
    let typeIdentifier: String
    let startDate: Date?
    let endDate: Date?
    let numericValue: Double?
    let unit: String?
    let categoryValue: Int?
    let sourceName: String?
    let sourceBundleIdentifier: String?
    let sourceVersion: String?
    let deviceName: String?
    let deviceModel: String?
    let deviceManufacturer: String?
    let metadata: [String: String]

    static func deletion(_ object: HKDeletedObject, typeIdentifier: String) -> HealthChange {
        HealthChange(
            id: "delete:\(object.uuid.uuidString)",
            operation: .delete,
            sampleID: object.uuid,
            typeIdentifier: typeIdentifier,
            startDate: nil,
            endDate: nil,
            numericValue: nil,
            unit: nil,
            categoryValue: nil,
            sourceName: nil,
            sourceBundleIdentifier: nil,
            sourceVersion: nil,
            deviceName: nil,
            deviceModel: nil,
            deviceManufacturer: nil,
            metadata: [:]
        )
    }
}

enum HealthPipelineError: LocalizedError {
    case queueFull(limit: Int)
    case missingAnchor
    case missingStatistics
    case localStorageUnavailable

    var errorDescription: String? {
        switch self {
        case let .queueFull(limit):
            "Local health queue reached its safe limit of \(limit) changes. Connect an upload destination before collecting more."
        case .missingAnchor:
            "HealthKit did not return an incremental query anchor."
        case .missingStatistics:
            "HealthKit did not return daily statistics."
        case .localStorageUnavailable:
            "Local protected storage could not be opened."
        }
    }
}

final class ProtectedHealthQueue {
    private struct Payload: Codable {
        var changes: [HealthChange]
    }

    private let fileURL: URL
    private let capacity: Int
    private var changes: [HealthChange]

    init(fileURL: URL = ProtectedHealthQueue.defaultFileURL(), capacity: Int = 25_000) throws {
        self.fileURL = fileURL
        self.capacity = capacity
        if FileManager.default.fileExists(atPath: fileURL.path) {
            let data = try Data(contentsOf: fileURL)
            changes = try JSONDecoder.health.decode(Payload.self, from: data).changes
        } else {
            changes = []
        }
    }

    var count: Int { changes.count }

    func nextBatch(limit: Int) -> [HealthChange] {
        Array(changes.prefix(max(0, limit)))
    }

    func acknowledge(ids: Set<String>) throws {
        guard !ids.isEmpty else { return }
        changes.removeAll { ids.contains($0.id) }
        try persist()
    }

    func enqueue(_ incoming: [HealthChange]) throws {
        guard !incoming.isEmpty else { return }

        var merged = Dictionary(uniqueKeysWithValues: changes.map { ($0.id, $0) })
        for change in incoming {
            if change.operation == .delete {
                merged.removeValue(forKey: "upsert:\(change.sampleID.uuidString)")
            }
            merged[change.id] = change
        }

        guard merged.count <= capacity else {
            throw HealthPipelineError.queueFull(limit: capacity)
        }

        changes = merged.values.sorted {
            ($0.startDate ?? .distantPast, $0.id) < ($1.startDate ?? .distantPast, $1.id)
        }
        try persist()
    }

    func reset() throws {
        changes = []
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }

    private func persist() throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try JSONEncoder.health.encode(Payload(changes: changes))
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
    }

    private static func defaultFileURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root.appendingPathComponent("Kairo", isDirectory: true)
            .appendingPathComponent("health-change-queue.json")
    }
}

final class HealthAnchorStore {
    private let directoryURL: URL

    init(directoryURL: URL = HealthAnchorStore.defaultDirectoryURL()) {
        self.directoryURL = directoryURL
    }

    func anchor(for typeIdentifier: String) throws -> HKQueryAnchor? {
        let url = fileURL(for: typeIdentifier)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        return try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func save(_ anchor: HKQueryAnchor, for typeIdentifier: String) throws {
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        try data.write(to: fileURL(for: typeIdentifier), options: [.atomic, .completeFileProtection])
    }

    func reset() throws {
        guard FileManager.default.fileExists(atPath: directoryURL.path) else { return }
        try FileManager.default.removeItem(at: directoryURL)
    }

    private func fileURL(for identifier: String) -> URL {
        let safeName = Data(identifier.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
        return directoryURL.appendingPathComponent(safeName).appendingPathExtension("anchor")
    }

    private static func defaultDirectoryURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root.appendingPathComponent("Kairo/HealthAnchors", isDirectory: true)
    }

    static func historical() -> HealthAnchorStore {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return HealthAnchorStore(
            directoryURL: root.appendingPathComponent("Kairo/HealthBackfillAnchors", isDirectory: true)
        )
    }
}

final class HealthBackfillProgressStore {
    private let fileURL: URL

    init(fileURL: URL = HealthBackfillProgressStore.defaultFileURL()) {
        self.fileURL = fileURL
    }

    func load() throws -> HealthBackfillProgress? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        return try JSONDecoder.health.decode(
            HealthBackfillProgress.self,
            from: Data(contentsOf: fileURL)
        )
    }

    func save(_ progress: HealthBackfillProgress) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder.health.encode(progress).write(
            to: fileURL,
            options: [.atomic, .completeFileProtection]
        )
    }

    func reset() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }
        try FileManager.default.removeItem(at: fileURL)
    }

    private static func defaultFileURL() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return root.appendingPathComponent("Kairo/health-backfill-progress.json")
    }
}

@MainActor
final class HealthIncrementalCollector {
    private struct QueryPage {
        let samples: [HKSample]
        let deletions: [HKDeletedObject]
        let anchor: HKQueryAnchor
    }

    private let store: HKHealthStore
    private let queue: ProtectedHealthQueue
    private let anchors: HealthAnchorStore
    private let historicalAnchors: HealthAnchorStore
    private let historicalProgressStore: HealthBackfillProgressStore
    private let initialLookback: TimeInterval

    init(
        store: HKHealthStore,
        queue: ProtectedHealthQueue? = nil,
        anchors: HealthAnchorStore = HealthAnchorStore(),
        historicalAnchors: HealthAnchorStore = .historical(),
        historicalProgressStore: HealthBackfillProgressStore = HealthBackfillProgressStore(),
        initialLookback: TimeInterval = 24 * 60 * 60
    ) throws {
        self.store = store
        self.queue = try queue ?? ProtectedHealthQueue()
        self.anchors = anchors
        self.historicalAnchors = historicalAnchors
        self.historicalProgressStore = historicalProgressStore
        self.initialLookback = initialLookback
    }

    func collect(
        sampleTypes: [HKSampleType] = HealthDataCatalog.sampleTypes
    ) async -> HealthCollectionStatus {
        let rawQuantityTypes = sampleTypes.compactMap { type -> HKQuantityType? in
            guard HealthDataCatalog.retentionStrategy(for: type) == .raw else { return nil }
            return type as? HKQuantityType
        }
        let units = await preferredUnits(for: rawQuantityTypes)
        var scanned = 0
        var failures = 0

        for type in sampleTypes {
            do {
                switch HealthDataCatalog.retentionStrategy(for: type) {
                case .raw:
                    let existingAnchor = try anchors.anchor(for: type.identifier)
                    let predicate = existingAnchor == nil
                        ? HKQuery.predicateForSamples(
                            withStart: Date().addingTimeInterval(-initialLookback),
                            end: nil,
                            options: .strictStartDate
                        )
                        : nil
                    let page = try await query(type: type, predicate: predicate, anchor: existingAnchor)
                    let changes = page.samples.map {
                        normalize($0, preferredUnit: ($0.sampleType as? HKQuantityType).flatMap { units[$0] })
                    } + page.deletions.map {
                        HealthChange.deletion($0, typeIdentifier: type.identifier)
                    }

                    // The anchor advances only after its changes are protected on disk.
                    try queue.enqueue(changes)
                    try anchors.save(page.anchor, for: type.identifier)
                case .dailySummary:
                    guard let quantityType = type as? HKQuantityType else { break }
                    let now = Date()
                    let start = Calendar.current.startOfDay(
                        for: now.addingTimeInterval(-initialLookback)
                    )
                    try queue.enqueue(try await dailySummaries(
                        for: quantityType,
                        from: start,
                        to: now
                    ))
                case .discard:
                    break
                }
                scanned += 1
            } catch {
                failures += 1
            }
        }

        return HealthCollectionStatus(
            queuedChanges: queue.count,
            typesScanned: scanned,
            failedTypes: failures,
            lastCollectedAt: Date(),
            message: failures == 0
                ? "All sample types reconciled on this iPhone"
                : "Reconciled \(scanned) types; \(failures) need another pass"
        )
    }

    var queuedChangeCount: Int { queue.count }

    func nextUploadBatch(limit: Int) -> [HealthChange] {
        queue.nextBatch(limit: limit)
    }

    func acknowledgeUploadedChanges(ids: Set<String>) throws {
        try queue.acknowledge(ids: ids)
    }

    func historicalProgress() throws -> HealthBackfillProgress? {
        try historicalProgressStore.load()
    }

    func resetReplayCursors() throws {
        try anchors.reset()
        try historicalAnchors.reset()
        try historicalProgressStore.reset()
    }

    func collectNextHistoricalPage(pageSize: Int = 250) async throws -> HealthBackfillProgress {
        var progress = try historicalProgressStore.load() ?? HealthBackfillProgress(
            cutoff: Date().addingTimeInterval(-initialLookback),
            typeIdentifiers: HealthDataCatalog.sampleTypes.map(\.identifier)
        )
        guard let typeIdentifier = progress.nextTypeIdentifier,
              let type = HealthDataCatalog.sampleTypes.first(where: { $0.identifier == typeIdentifier }) else {
            return progress
        }

        if HealthDataCatalog.retentionStrategy(for: type) == .dailySummary,
           let quantityType = type as? HKQuantityType {
            let changes = try await historicalDailySummaries(
                for: quantityType,
                cutoff: progress.cutoff
            )
            try queue.enqueue(changes)
            progress.recordPage(
                typeIdentifier: typeIdentifier,
                changes: changes.count,
                completedType: true
            )
            try historicalProgressStore.save(progress)
            return progress
        }

        let anchor = try historicalAnchors.anchor(for: typeIdentifier)
        let predicate = HKQuery.predicateForSamples(
            withStart: nil,
            end: progress.cutoff,
            options: .strictEndDate
        )
        let page = try await query(
            type: type,
            predicate: predicate,
            anchor: anchor,
            limit: pageSize
        )
        let units = await preferredUnits(for: [type].compactMap { $0 as? HKQuantityType })
        let changes = page.samples.map {
            normalize($0, preferredUnit: ($0.sampleType as? HKQuantityType).flatMap { units[$0] })
        } + page.deletions.map {
            HealthChange.deletion($0, typeIdentifier: typeIdentifier)
        }

        try queue.enqueue(changes)
        try historicalAnchors.save(page.anchor, for: typeIdentifier)
        progress.recordPage(
            typeIdentifier: typeIdentifier,
            changes: changes.count,
            completedType: changes.count < pageSize
        )
        try historicalProgressStore.save(progress)
        return progress
    }

    private func historicalDailySummaries(
        for type: HKQuantityType,
        cutoff: Date
    ) async throws -> [HealthChange] {
        guard let earliestDate = try await earliestSampleDate(for: type, before: cutoff) else {
            return []
        }
        return try await dailySummaries(
            for: type,
            from: Calendar.current.startOfDay(for: earliestDate),
            to: cutoff
        )
    }

    private func earliestSampleDate(
        for type: HKQuantityType,
        before endDate: Date
    ) async throws -> Date? {
        let predicate = HKQuery.predicateForSamples(
            withStart: nil,
            end: endDate,
            options: .strictEndDate
        )
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: 1,
                sortDescriptors: [
                    NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true),
                ]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: samples?.first?.startDate)
                }
            }
            store.execute(query)
        }
    }

    private func dailySummaries(
        for type: HKQuantityType,
        from startDate: Date,
        to endDate: Date
    ) async throws -> [HealthChange] {
        guard startDate < endDate else { return [] }
        let units = await preferredUnits(for: [type])
        guard let unit = units[type] else { return [] }
        let options = statisticsOptions(for: type)
        let collection = try await statisticsCollection(
            for: type,
            from: startDate,
            to: endDate,
            options: options
        )
        var changes: [HealthChange] = []

        collection.enumerateStatistics(from: startDate, to: endDate) { statistics, _ in
            let values: [(label: String, quantity: HKQuantity?)]
            if options.contains(.cumulativeSum) {
                values = [("sum", statistics.sumQuantity())]
            } else if options.contains(.discreteMin) {
                values = [
                    ("average", statistics.averageQuantity()),
                    ("minimum", statistics.minimumQuantity()),
                    ("maximum", statistics.maximumQuantity()),
                ]
            } else {
                values = [("average", statistics.averageQuantity())]
            }

            for value in values {
                guard let quantity = value.quantity else { continue }
                changes.append(Self.dailySummaryChange(
                    typeIdentifier: type.identifier,
                    statistic: value.label,
                    startDate: statistics.startDate,
                    endDate: statistics.endDate,
                    numericValue: quantity.doubleValue(for: unit),
                    unit: unit.unitString
                ))
            }
        }
        return changes
    }

    private func statisticsCollection(
        for type: HKQuantityType,
        from startDate: Date,
        to endDate: Date,
        options: HKStatisticsOptions
    ) async throws -> HKStatisticsCollection {
        let predicate = HKQuery.predicateForSamples(
            withStart: startDate,
            end: endDate,
            options: []
        )
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: options,
                anchorDate: Calendar.current.startOfDay(for: startDate),
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, collection, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let collection {
                    continuation.resume(returning: collection)
                } else {
                    continuation.resume(throwing: HealthPipelineError.missingStatistics)
                }
            }
            store.execute(query)
        }
    }

    private func statisticsOptions(for type: HKQuantityType) -> HKStatisticsOptions {
        switch type.aggregationStyle {
        case .cumulative:
            .cumulativeSum
        case .discreteArithmetic:
            [.discreteAverage, .discreteMin, .discreteMax]
        default:
            .discreteAverage
        }
    }

    private static func dailySummaryChange(
        typeIdentifier: String,
        statistic: String,
        startDate: Date,
        endDate: Date,
        numericValue: Double,
        unit: String
    ) -> HealthChange {
        let identity = "daily:\(typeIdentifier):\(statistic):\(startDate.timeIntervalSince1970)"
        let sampleID = deterministicUUID(for: identity)
        return HealthChange(
            id: "upsert:\(sampleID.uuidString)",
            operation: .upsert,
            sampleID: sampleID,
            typeIdentifier: typeIdentifier,
            startDate: startDate,
            endDate: endDate,
            numericValue: numericValue,
            unit: unit,
            categoryValue: nil,
            sourceName: nil,
            sourceBundleIdentifier: nil,
            sourceVersion: nil,
            deviceName: nil,
            deviceModel: nil,
            deviceManufacturer: nil,
            metadata: ["aggregation": "daily.\(statistic)"]
        )
    }

    private static func deterministicUUID(for value: String) -> UUID {
        let bytes = Array(SHA256.hash(data: Data(value.utf8)).prefix(16))
        let uuid: uuid_t = (
            bytes[0], bytes[1], bytes[2], bytes[3],
            bytes[4], bytes[5], (bytes[6] & 0x0F) | 0x50, bytes[7],
            (bytes[8] & 0x3F) | 0x80, bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15]
        )
        return UUID(uuid: uuid)
    }

    private func query(
        type: HKSampleType,
        predicate: NSPredicate?,
        anchor: HKQueryAnchor?,
        limit: Int = HKObjectQueryNoLimit
    ) async throws -> QueryPage {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: type,
                predicate: predicate,
                anchor: anchor,
                limit: limit
            ) { _, samples, deletions, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let newAnchor {
                    continuation.resume(returning: QueryPage(
                        samples: samples ?? [],
                        deletions: deletions ?? [],
                        anchor: newAnchor
                    ))
                } else {
                    continuation.resume(throwing: HealthPipelineError.missingAnchor)
                }
            }
            store.execute(query)
        }
    }

    private func preferredUnits(for types: [HKQuantityType]) async -> [HKQuantityType: HKUnit] {
        guard !types.isEmpty else { return [:] }
        return await withCheckedContinuation { continuation in
            store.preferredUnits(for: Set(types)) { units, _ in
                continuation.resume(returning: units)
            }
        }
    }

    private func normalize(_ sample: HKSample, preferredUnit: HKUnit?) -> HealthChange {
        var numericValue: Double?
        var unit: String?
        var categoryValue: Int?
        var metadata = normalizedMetadata(sample.metadata)

        if let quantity = sample as? HKQuantitySample, let preferredUnit {
            numericValue = quantity.quantity.doubleValue(for: preferredUnit)
            unit = preferredUnit.unitString
        } else if let category = sample as? HKCategorySample {
            categoryValue = category.value
        } else if let workout = sample as? HKWorkout {
            numericValue = workout.duration
            unit = "s"
            metadata["workoutActivityType"] = String(workout.workoutActivityType.rawValue)
            if let activeEnergyType = HKQuantityType.quantityType(
                forIdentifier: .activeEnergyBurned
            ), let energy = workout.statistics(for: activeEnergyType)?.sumQuantity() {
                metadata["totalEnergyKilocalories"] = String(
                    energy.doubleValue(for: .kilocalorie())
                )
            }
            if let distance = workout.totalDistance {
                metadata["totalDistanceMeters"] = String(
                    distance.doubleValue(for: .meter())
                )
            }
        } else if let state = sample as? HKStateOfMind {
            numericValue = state.valence
            unit = "valence"
            metadata["kind"] = String(state.kind.rawValue)
            metadata["valenceClassification"] = String(state.valenceClassification.rawValue)
            metadata["labels"] = state.labels
                .map { String($0.rawValue) }
                .sorted()
                .joined(separator: ",")
            metadata["associations"] = state.associations
                .map { String($0.rawValue) }
                .sorted()
                .joined(separator: ",")
        } else if let assessment = sample as? HKScoredAssessment {
            numericValue = Double(assessment.score)
            unit = "score"
        } else if let electrocardiogram = sample as? HKElectrocardiogram {
            numericValue = electrocardiogram.averageHeartRate?.doubleValue(
                for: HKUnit.count().unitDivided(by: .minute())
            )
            unit = numericValue == nil ? nil : "count/min"
            metadata["classification"] = String(electrocardiogram.classification.rawValue)
            metadata["symptomsStatus"] = String(electrocardiogram.symptomsStatus.rawValue)
            metadata["voltageMeasurementCount"] = String(electrocardiogram.numberOfVoltageMeasurements)
        }

        let source = sample.sourceRevision
        let device = sample.device
        return HealthChange(
            id: "upsert:\(sample.uuid.uuidString)",
            operation: .upsert,
            sampleID: sample.uuid,
            typeIdentifier: sample.sampleType.identifier,
            startDate: sample.startDate,
            endDate: sample.endDate,
            numericValue: numericValue,
            unit: unit,
            categoryValue: categoryValue,
            sourceName: source.source.name,
            sourceBundleIdentifier: source.source.bundleIdentifier,
            sourceVersion: source.version,
            deviceName: device?.name,
            deviceModel: device?.model,
            deviceManufacturer: device?.manufacturer,
            metadata: metadata
        )
    }

    private func normalizedMetadata(_ metadata: [String: Any]?) -> [String: String] {
        guard let metadata else { return [:] }
        return metadata.reduce(into: [:]) { result, pair in
            switch pair.value {
            case let value as String:
                result[pair.key] = value
            case let value as NSNumber:
                result[pair.key] = value.stringValue
            case let value as Date:
                result[pair.key] = ISO8601DateFormatter().string(from: value)
            case let value as URL:
                result[pair.key] = value.absoluteString
            default:
                break
            }
        }
    }
}

private extension JSONEncoder {
    static var health: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

private extension JSONDecoder {
    static var health: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
