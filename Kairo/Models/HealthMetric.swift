import Foundation

enum HealthMetric: String, CaseIterable, Codable, Identifiable, Sendable {
    case mood
    case sleep
    case move
    case exercise
    case stand
    case weight
    case heartRate
    case restingHeartRate
    case heartRateVariability

    var id: String { rawValue }

    var title: String {
        switch self {
        case .mood: "Mood"
        case .sleep: "Sleep"
        case .move: "Move"
        case .exercise: "Exercise"
        case .stand: "Stand"
        case .weight: "Weight"
        case .heartRate: "Heart rate"
        case .restingHeartRate: "Resting HR"
        case .heartRateVariability: "HRV"
        }
    }

    var symbol: String {
        switch self {
        case .mood: "face.smiling"
        case .sleep: "moon.stars.fill"
        case .move: "flame.fill"
        case .exercise: "figure.run"
        case .stand: "figure.stand"
        case .weight: "scalemass.fill"
        case .heartRate: "heart.fill"
        case .restingHeartRate: "heart.text.square.fill"
        case .heartRateVariability: "waveform.path.ecg"
        }
    }
}

struct HealthReading: Identifiable, Equatable, Sendable {
    let metric: HealthMetric
    let value: String
    let unit: String
    let measuredAt: Date?

    var id: HealthMetric { metric }

    static func unavailable(_ metric: HealthMetric) -> Self {
        Self(metric: metric, value: "—", unit: "No data", measuredAt: nil)
    }
}

struct HealthSnapshot: Equatable, Sendable {
    let readings: [HealthReading]
    let refreshedAt: Date

    static let empty = HealthSnapshot(
        readings: HealthMetric.allCases.map(HealthReading.unavailable),
        refreshedAt: .now
    )
}
