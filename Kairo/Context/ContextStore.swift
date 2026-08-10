import CoreLocation
import FamilyControls
import Foundation
import MusicKit

@MainActor
final class ContextStore: ObservableObject {
    @Published private(set) var queuedObservations = 0
    @Published private(set) var lastSyncedAt: Date?
    @Published private(set) var statusMessage = "Choose the context sources you want Kairo to use."
    @Published private(set) var isRefreshing = false

    private let queue: ProtectedContextQueue?
    private let uploadClient = ContextUploadClient()
    private lazy var locationCollector = LocationVisitCollector { [weak self] observation in
        guard let self else { return }
        do {
            try self.queue?.enqueue([observation])
            self.queuedObservations = self.queue?.count ?? 0
            Task { await self.uploadQueuedObservations() }
        } catch {
            self.statusMessage = error.localizedDescription
        }
    }

    init() {
        queue = try? ProtectedContextQueue()
        queuedObservations = queue?.count ?? 0
    }

    var screenTimeAuthorized: Bool {
        let status = AuthorizationCenter.shared.authorizationStatus
        guard #available(iOS 26.4, *) else { return false }
        return status == .approvedWithDataAccess
    }

    var musicAuthorized: Bool { MusicAuthorization.currentStatus == .authorized }

    var locationAuthorized: Bool {
        locationCollector.authorizationStatus == .authorizedAlways
            || locationCollector.authorizationStatus == .authorizedWhenInUse
    }

    func prepare() async {
        if locationAuthorized { locationCollector.start() }
        await refresh()
    }

    func requestScreenTimeAuthorization() async {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            if screenTimeAuthorized {
                await refresh()
            } else {
                statusMessage = "Basic Screen Time permission is active, but detailed data access is unavailable for this device, region or provisioning profile."
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func requestMusicAuthorization() async {
        let status = await MusicAuthorization.request()
        guard status == .authorized else {
            statusMessage = "Apple Music access was not granted."
            return
        }
        await refresh()
    }

    func requestLocationAuthorization() {
        locationCollector.requestAuthorization()
    }

    func refresh() async {
        guard !isRefreshing, let queue else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        var observations: [ContextObservation] = []

        do {
            if screenTimeAuthorized {
                guard #available(iOS 26.4, *) else {
                    throw ContextCollectionError.unsupportedScreenTimeVersion
                }
                observations += try await ScreenTimeCollector.collect()
            }
            if musicAuthorized {
                observations += try await MusicContextCollector.collect()
            }
            try queue.enqueue(observations)
            queuedObservations = queue.count
            statusMessage = observations.isEmpty
                ? "No new context observations were available."
                : "Collected \(observations.count) context observations."
            await uploadQueuedObservations()
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func uploadQueuedObservations() async {
        guard let queue else { return }
        do {
            let result = try await uploadClient.uploadAll(from: queue)
            queuedObservations = result.remaining
            if result.sent > 0 {
                lastSyncedAt = .now
                statusMessage = "Synced \(result.sent) context observations."
            }
        } catch {
            queuedObservations = queue.count
            statusMessage = error.localizedDescription
        }
    }
}
