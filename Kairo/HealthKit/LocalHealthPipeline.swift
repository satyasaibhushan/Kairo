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

    var errorDescription: String? {
        switch self {
        case let .queueFull(limit):
            "Local health queue reached its safe limit of \(limit) changes. Connect an upload destination before collecting more."
        case .missingAnchor:
            "HealthKit did not return an incremental query anchor."
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
        let units = await preferredUnits(for: sampleTypes.compactMap { $0 as? HKQuantityType })
        var scanned = 0
        var failures = 0

        for type in sampleTypes {
            do {
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

    func collectNextHistoricalPage(pageSize: Int = 250) async throws -> HealthBackfillProgress {
        var progress = try historicalProgressStore.load() ?? HealthBackfillProgress(
            cutoff: Date().addingTimeInterval(-initialLookback),
            typeIdentifiers: HealthDataCatalog.sampleTypes.map(\.identifier)
        )
        guard let typeIdentifier = progress.nextTypeIdentifier,
              let type = HealthDataCatalog.sampleTypes.first(where: { $0.identifier == typeIdentifier }) else {
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
        } else if let state = sample as? HKStateOfMind {
            numericValue = state.valence
            unit = "valence"
            metadata["kind"] = String(state.kind.rawValue)
            metadata["valenceClassification"] = String(state.valenceClassification.rawValue)
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
