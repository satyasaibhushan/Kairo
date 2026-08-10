import Foundation

enum ContextObservationOperation: String, Codable {
    case upsert
    case delete
}

struct ContextObservation: Codable, Identifiable, Equatable {
    let id: String
    let operation: ContextObservationOperation
    let sourceSystem: String
    let observationID: String
    let metricKey: String
    let observedStart: Date?
    let observedEnd: Date?
    let numericValue: Double?
    let unit: String?
    let textValue: String?
    let metadata: [String: String]

    init(
        sourceSystem: String,
        observationID: String,
        metricKey: String,
        observedStart: Date?,
        observedEnd: Date? = nil,
        numericValue: Double? = nil,
        unit: String? = nil,
        textValue: String? = nil,
        metadata: [String: String] = [:],
        operation: ContextObservationOperation = .upsert
    ) {
        self.id = "\(operation.rawValue):\(sourceSystem):\(observationID)"
        self.operation = operation
        self.sourceSystem = sourceSystem
        self.observationID = observationID
        self.metricKey = metricKey
        self.observedStart = observedStart
        self.observedEnd = observedEnd
        self.numericValue = numericValue
        self.unit = unit
        self.textValue = textValue
        self.metadata = metadata
    }
}

final class ProtectedContextQueue {
    private struct Payload: Codable {
        var observations: [ContextObservation]
    }

    private let fileURL: URL
    private let capacity: Int
    private var observations: [ContextObservation]

    init(fileURL: URL = ProtectedContextQueue.defaultFileURL(), capacity: Int = 10_000) throws {
        self.fileURL = fileURL
        self.capacity = capacity
        if FileManager.default.fileExists(atPath: fileURL.path) {
            observations = try JSONDecoder.context.decode(
                Payload.self,
                from: Data(contentsOf: fileURL)
            ).observations
        } else {
            observations = []
        }
    }

    var count: Int { observations.count }

    func nextBatch(limit: Int) -> [ContextObservation] {
        Array(observations.prefix(max(0, limit)))
    }

    func acknowledge(ids: Set<String>) throws {
        guard !ids.isEmpty else { return }
        observations.removeAll { ids.contains($0.id) }
        try persist()
    }

    func enqueue(_ incoming: [ContextObservation]) throws {
        guard !incoming.isEmpty else { return }
        var merged = Dictionary(uniqueKeysWithValues: observations.map { ($0.id, $0) })
        incoming.forEach { merged[$0.id] = $0 }
        guard merged.count <= capacity else {
            throw ContextCollectionError.queueFull(limit: capacity)
        }
        observations = merged.values.sorted {
            ($0.observedStart ?? .distantPast, $0.id) < ($1.observedStart ?? .distantPast, $1.id)
        }
        try persist()
    }

    private func persist() throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try JSONEncoder.context.encode(Payload(observations: observations)).write(
            to: fileURL,
            options: [.atomic, .completeFileProtection]
        )
    }

    private static func defaultFileURL() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Kairo", isDirectory: true)
            .appendingPathComponent("context-observation-queue.json")
    }
}

enum ContextCollectionError: LocalizedError {
    case queueFull(limit: Int)
    case unsupportedScreenTimeVersion

    var errorDescription: String? {
        switch self {
        case let .queueFull(limit):
            "The protected context queue reached its limit of \(limit) observations."
        case .unsupportedScreenTimeVersion:
            "Detailed Screen Time collection requires iOS 26.4 or newer."
        }
    }
}

extension JSONEncoder {
    static var context: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

extension JSONDecoder {
    static var context: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
