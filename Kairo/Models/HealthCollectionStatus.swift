import Foundation

struct HealthCollectionStatus: Equatable {
    var queuedChanges = 0
    var typesScanned = 0
    var failedTypes = 0
    var lastCollectedAt: Date?
    var message = "Waiting for the first collection"

    var isHealthy: Bool { failedTypes == 0 }
}

