import Foundation
import Security

struct HealthSyncConfiguration: Codable, Equatable {
    let endpoint: URL
    let ingestToken: String
    let siteAccessToken: String

    init(pairingCode: String) throws {
        let trimmed = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let encoded = Data(base64URLEncoded: trimmed) else {
            throw HealthSyncConfigurationError.invalidPairingCode
        }
        let configuration = try JSONDecoder().decode(HealthSyncConfiguration.self, from: encoded)
        guard configuration.endpoint.scheme == "https",
              !configuration.ingestToken.isEmpty,
              !configuration.siteAccessToken.isEmpty else {
            throw HealthSyncConfigurationError.invalidPairingCode
        }
        self = configuration
    }

    private init(endpoint: URL, ingestToken: String, siteAccessToken: String) {
        self.endpoint = endpoint
        self.ingestToken = ingestToken
        self.siteAccessToken = siteAccessToken
    }
}

enum HealthSyncConfigurationError: LocalizedError {
    case invalidPairingCode
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidPairingCode:
            "That pairing code is invalid. Copy the complete code and try again."
        case let .keychain(status):
            "The secure iPhone Keychain returned error \(status)."
        }
    }
}

final class HealthSyncConfigurationStore {
    private let service = "com.satyasaibhushan.kairo.health-sync"
    private let configurationAccount = "configuration"
    private let deviceAccount = "device-id"

    func load() throws -> HealthSyncConfiguration? {
        guard let data = try read(account: configurationAccount) else { return nil }
        return try JSONDecoder().decode(HealthSyncConfiguration.self, from: data)
    }

    func save(_ configuration: HealthSyncConfiguration) throws {
        try write(try JSONEncoder().encode(configuration), account: configurationAccount)
    }

    func deviceID() throws -> String {
        if let data = try read(account: deviceAccount),
           let identifier = String(data: data, encoding: .utf8) {
            return identifier
        }
        let identifier = UUID().uuidString.lowercased()
        try write(Data(identifier.utf8), account: deviceAccount)
        return identifier
    }

    private func read(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw HealthSyncConfigurationError.keychain(status)
        }
        return data
    }

    private func write(_ data: Data, account: String) throws {
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw HealthSyncConfigurationError.keychain(updateStatus)
        }

        var insert = key
        attributes.forEach { insert[$0.key] = $0.value }
        let insertStatus = SecItemAdd(insert as CFDictionary, nil)
        guard insertStatus == errSecSuccess else {
            throw HealthSyncConfigurationError.keychain(insertStatus)
        }
    }
}

private extension Data {
    init?(base64URLEncoded value: String) {
        var base64 = value.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        base64.append(String(repeating: "=", count: (4 - base64.count % 4) % 4))
        self.init(base64Encoded: base64)
    }
}
