import CryptoKit
import Foundation

struct ContextUploadResult: Equatable {
    let sent: Int
    let remaining: Int
}

@MainActor
final class ContextUploadClient {
    private struct UploadBatch: Encodable {
        let batchId: String
        let deviceId: String
        let sentAt: Date
        let observations: [ContextObservation]
    }

    private struct Acknowledgement: Decodable {
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

    func uploadAll(from queue: ProtectedContextQueue) async throws -> ContextUploadResult {
        guard let configuration = try configurationStore.load() else {
            return ContextUploadResult(sent: 0, remaining: queue.count)
        }
        let deviceID = try configurationStore.deviceID()
        var sent = 0
        while !Task.isCancelled {
            let observations = queue.nextBatch(limit: 250)
            guard !observations.isEmpty else { break }
            let batchID = deterministicBatchID(observations)
            let payload = UploadBatch(
                batchId: batchID,
                deviceId: deviceID,
                sentAt: .now,
                observations: observations
            )
            let acknowledgement = try await send(payload, configuration: configuration)
            let expected = Set(observations.map(\.id))
            guard acknowledgement.batchId == batchID,
                  acknowledgement.accepted == observations.count,
                  Set(acknowledgement.acknowledgedIds) == expected else {
                throw HealthUploadError.incompleteAcknowledgement
            }
            try queue.acknowledge(ids: expected)
            sent += observations.count
        }
        return ContextUploadResult(sent: sent, remaining: queue.count)
    }

    private func send(
        _ payload: UploadBatch,
        configuration: HealthSyncConfiguration
    ) async throws -> Acknowledgement {
        var request = URLRequest(url: configuration.contextEndpoint)
        request.timeoutInterval = 20
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(
            "Bearer \(configuration.ingestToken)",
            forHTTPHeaderField: "authorization"
        )
        request.setValue(
            "Bearer \(configuration.siteAccessToken)",
            forHTTPHeaderField: "OAI-Sites-Authorization"
        )
        request.httpBody = try JSONEncoder.context.encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw HealthUploadError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data).error)
                ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
            throw HealthUploadError.server(status: response.statusCode, message: message)
        }
        return try JSONDecoder().decode(Acknowledgement.self, from: data)
    }

    private func deterministicBatchID(_ observations: [ContextObservation]) -> String {
        let material = observations.map(\.id).joined(separator: "\n")
        return SHA256.hash(data: Data(material.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
