import Foundation

enum HealthSyncStatus: Equatable {
    case notConfigured
    case ready
    case uploading(sent: Int)
    case synced(date: Date, sent: Int)
    case failed(String)

    var label: String {
        switch self {
        case .notConfigured: "NOT PAIRED"
        case .ready: "READY"
        case .uploading: "UPLOADING"
        case .synced: "SYNCED"
        case .failed: "RETRYING"
        }
    }

    var detail: String {
        switch self {
        case .notConfigured:
            "Pair this iPhone once to send acknowledged batches to your private Kairo ledger."
        case .ready:
            "The private ledger is paired and ready."
        case let .uploading(sent):
            "Uploaded \(sent) changes in this pass."
        case let .synced(date, sent):
            sent == 0
                ? "Queue confirmed empty at \(date.formatted(date: .omitted, time: .shortened))."
                : "Server acknowledged \(sent) changes at \(date.formatted(date: .omitted, time: .shortened))."
        case let .failed(message):
            message
        }
    }

    var isFailure: Bool {
        if case .failed = self { return true }
        return false
    }
}
