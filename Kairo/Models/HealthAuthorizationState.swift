import Foundation

enum HealthAuthorizationState: Equatable, Sendable {
    case unavailable
    case notRequested
    case requesting
    case requested
    case failed(String)

    var title: String {
        switch self {
        case .unavailable: "HealthKit unavailable"
        case .notRequested: "Connect Apple Health"
        case .requesting: "Requesting access…"
        case .requested: "Apple Health connected"
        case .failed: "Connection needs attention"
        }
    }

    var detail: String {
        switch self {
        case .unavailable:
            "Run Kairo on a compatible iPhone to read health data."
        case .notRequested:
            "Choose exactly which signals Kairo may read. You remain in control in Health settings."
        case .requesting:
            "Waiting for the Health permission sheet."
        case .requested:
            "Kairo reads only the categories you enabled."
        case let .failed(message):
            message
        }
    }
}
