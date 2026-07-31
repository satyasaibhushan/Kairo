import Foundation

enum HealthSyncStatus: Equatable {
    case notConfigured
    case ready
    case uploading(sent: Int, total: Int)
    case synced(date: Date, sent: Int)
    case failed(String)

    var label: String {
        switch self {
        case .notConfigured: "NOT PAIRED"
        case .ready: "READY"
        case let .uploading(sent, total):
            "UPLOADING \(Self.percentage(sent: sent, total: total))%"
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
        case let .uploading(sent, total):
            "\(sent.formatted()) of \(total.formatted()) changes acknowledged."
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

    private static func percentage(sent: Int, total: Int) -> Int {
        guard total > 0 else { return 100 }
        return min(100, Int((Double(sent) / Double(total) * 100).rounded()))
    }
}
