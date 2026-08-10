import BackgroundTasks
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
    private lazy var locationCollector = LocationVisitCollector(
        onObservation: { [weak self] observation in
            guard let self else { return }
            do {
                try self.queue?.enqueue([observation])
                self.queuedObservations = self.queue?.count ?? 0
                Task { await self.uploadQueuedObservations() }
            } catch {
                self.statusMessage = error.localizedDescription
            }
        },
        onAuthorizationChange: { [weak self] status in
            guard let self else { return }
            self.objectWillChange.send()
            switch status {
            case .authorizedAlways:
                self.statusMessage = "Automatic coarse location collection is enabled."
            case .authorizedWhenInUse:
                self.statusMessage = "Location works while Kairo is open. Tap Enable again and choose Always for automatic visits."
            case .denied, .restricted:
                self.statusMessage = "Location access was not granted."
            case .notDetermined:
                break
            @unknown default:
                break
            }
        }
    )

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
    }

    var locationAuthorizationLimited: Bool {
        locationCollector.authorizationStatus == .authorizedWhenInUse
    }

    func prepare() async {
        if locationAuthorized || locationAuthorizationLimited {
            locationCollector.start()
        }
        await refresh()
        ContextBackgroundRefreshScheduler.schedule()
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
        _ = await performRefresh()
    }

    func performBackgroundRefresh() async -> Bool {
        if locationAuthorized || locationAuthorizationLimited {
            locationCollector.start()
        }
        return await performRefresh()
    }

    private func performRefresh() async -> Bool {
        guard !isRefreshing else { return true }
        guard let queue else { return false }
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
            return !Task.isCancelled
        } catch {
            statusMessage = error.localizedDescription
            return false
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

@MainActor
enum ContextBackgroundRefreshScheduler {
    static let identifier = "com.satyasaibhushan.kairo.context-refresh"
    static let earliestRefreshInterval: TimeInterval = 60 * 60

    static func register(refresh: @escaping @MainActor () async -> Bool) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier,
            using: .main
        ) { task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            schedule()
            let operation = Task { @MainActor in
                let succeeded = await refresh()
                refreshTask.setTaskCompleted(success: succeeded && !Task.isCancelled)
            }
            refreshTask.expirationHandler = {
                operation.cancel()
            }
        }
    }

    static func schedule(now: Date = .now) {
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = now.addingTimeInterval(earliestRefreshInterval)
        try? BGTaskScheduler.shared.submit(request)
    }
}
