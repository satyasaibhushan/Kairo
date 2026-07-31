import CryptoKit
import Foundation

struct HealthUploadResult: Equatable {
    let sent: Int
    let remaining: Int
}

enum HealthUploadError: LocalizedError {
    case invalidResponse
    case server(status: Int, message: String)
    case incompleteAcknowledgement

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "The private ledger returned an unreadable response."
        case let .server(status, message):
            "Ledger error \(status): \(message)"
        case .incompleteAcknowledgement:
            "The ledger did not acknowledge the complete batch. Nothing was removed locally."
        }
    }
}

@MainActor
final class HealthUploadClient {
    private struct UploadBatch: Encodable {
        let batchId: String
        let deviceId: String
        let sentAt: Date
        let changes: [HealthChange]
    }

    private struct UploadAcknowledgement: Decodable {
        let batchId: String
        let accepted: Int
        let acknowledgedIds: [String]
    }

    private struct ServerError: Decodable {
        let error: String
    }

    private let session: URLSession
    private let configurationStore: HealthSyncConfigurationStore

    init(
        session: URLSession = .shared,
        configurationStore: HealthSyncConfigurationStore = HealthSyncConfigurationStore()
    ) {
        self.session = session
        self.configurationStore = configurationStore
    }

    func uploadAll(
        from collector: HealthIncrementalCollector,
        progress: (HealthUploadResult) -> Void = { _ in }
    ) async throws -> HealthUploadResult {
        guard let configuration = try configurationStore.load() else {
            return HealthUploadResult(sent: 0, remaining: collector.queuedChangeCount)
        }

        let deviceID = try configurationStore.deviceID()
        var sent = 0
        while !Task.isCancelled {
            let changes = collector.nextUploadBatch(limit: 250)
            guard !changes.isEmpty else { break }
            let batchID = deterministicBatchID(changes)
            let payload = UploadBatch(
                batchId: batchID,
                deviceId: deviceID,
                sentAt: Date(),
                changes: changes
            )
            let acknowledgement = try await send(payload, configuration: configuration)
            let expectedIDs = Set(changes.map(\.id))
            let acknowledgedIDs = Set(acknowledgement.acknowledgedIds)
            guard acknowledgement.batchId == batchID,
                  acknowledgement.accepted == changes.count,
                  acknowledgedIDs == expectedIDs else {
                throw HealthUploadError.incompleteAcknowledgement
            }
            try collector.acknowledgeUploadedChanges(ids: acknowledgedIDs)
            sent += changes.count
            progress(HealthUploadResult(
                sent: sent,
                remaining: collector.queuedChangeCount
            ))
        }

        return HealthUploadResult(sent: sent, remaining: collector.queuedChangeCount)
    }

    private func send(
        _ payload: UploadBatch,
        configuration: HealthSyncConfiguration
    ) async throws -> UploadAcknowledgement {
        var request = URLRequest(url: configuration.endpoint)
        request.timeoutInterval = 20
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(configuration.ingestToken)", forHTTPHeaderField: "authorization")
        request.setValue(
            "Bearer \(configuration.siteAccessToken)",
            forHTTPHeaderField: "OAI-Sites-Authorization"
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw HealthUploadError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).error)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw HealthUploadError.server(status: httpResponse.statusCode, message: message)
        }
        return try JSONDecoder().decode(UploadAcknowledgement.self, from: data)
    }

    private func deterministicBatchID(_ changes: [HealthChange]) -> String {
        let material = changes.map(\.id).joined(separator: "\n")
        return SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
