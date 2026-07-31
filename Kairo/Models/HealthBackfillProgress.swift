import Foundation

struct HealthBackfillProgress: Codable, Equatable {
    let cutoff: Date
    let typeIdentifiers: [String]
    private(set) var completedTypeIdentifiers: Set<String>
    private(set) var importedChanges: Int
    private(set) var updatedAt: Date

    init(cutoff: Date, typeIdentifiers: [String], updatedAt: Date = Date()) {
        self.cutoff = cutoff
        self.typeIdentifiers = typeIdentifiers
        completedTypeIdentifiers = []
        importedChanges = 0
        self.updatedAt = updatedAt
    }

    var nextTypeIdentifier: String? {
        typeIdentifiers.first { !completedTypeIdentifiers.contains($0) }
    }

    var completedTypes: Int { completedTypeIdentifiers.count }
    var totalTypes: Int { typeIdentifiers.count }
    var isComplete: Bool { nextTypeIdentifier == nil }

    var fractionComplete: Double {
        guard totalTypes > 0 else { return 1 }
        return Double(completedTypes) / Double(totalTypes)
    }

    mutating func recordPage(
        typeIdentifier: String,
        changes: Int,
        completedType: Bool,
        at date: Date = Date()
    ) {
        importedChanges += changes
        if completedType {
            completedTypeIdentifiers.insert(typeIdentifier)
        }
        updatedAt = date
    }
}

enum HealthBackfillStatus: Equatable {
    case notStarted
    case running(HealthBackfillProgress)
    case paused(HealthBackfillProgress)
    case completed(HealthBackfillProgress)
    case failed(String, HealthBackfillProgress?)

    var label: String {
        switch self {
        case .notStarted: "NOT STARTED"
        case .running: "IMPORTING"
        case .paused: "PAUSED"
        case .completed: "COMPLETE"
        case .failed: "RETRY NEEDED"
        }
    }

    var detail: String {
        switch self {
        case .notStarted:
            "Import the HealthKit history that predates Kairo's live collection."
        case let .running(progress):
            Self.progressDetail(progress)
        case let .paused(progress):
            "Paused. \(Self.progressDetail(progress))"
        case let .completed(progress):
            "Imported \(progress.importedChanges.formatted()) historical changes across \(progress.totalTypes) streams."
        case let .failed(message, _):
            message
        }
    }

    var progress: HealthBackfillProgress? {
        switch self {
        case .notStarted: nil
        case let .running(progress), let .paused(progress), let .completed(progress): progress
        case let .failed(_, progress): progress
        }
    }

    var isRunning: Bool {
        if case .running = self { return true }
        return false
    }

    private static func progressDetail(_ progress: HealthBackfillProgress) -> String {
        "\(progress.completedTypes) of \(progress.totalTypes) streams complete · \(progress.importedChanges.formatted()) changes imported."
    }
}
