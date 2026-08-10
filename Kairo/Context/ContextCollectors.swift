import CoreLocation
import DeviceActivity
import FamilyControls
import Foundation
import MusicKit
import SwiftUI

enum ScreenTimeCollector {
    @available(iOS 26.4, *)
    static func collect(days: Int = 7, now: Date = .now) async throws -> [ContextObservation] {
        let calendar = Calendar.current
        let start = calendar.startOfDay(
            for: calendar.date(byAdding: .day, value: -(days - 1), to: now) ?? now
        )
        let interval = DateInterval(start: start, end: now)
        let filter = DeviceActivityFilter(
            segment: .daily(during: interval),
            devices: .init([.iPhone])
        )
        var observations: [ContextObservation] = []

        for try await activity in DeviceActivityData.activityData(
            filteredBy: filter,
            using: .live
        ) {
            for try await segment in activity.activitySegments {
                var pickups = segment.totalPickupsWithoutApplicationActivity
                var notifications = 0
                var categoryMinutes: [String: Double] = [:]
                for try await category in segment.categories {
                    let categoryName = category.category.localizedDisplayName ?? "Other"
                    categoryMinutes[categoryName, default: 0] += category.totalActivityDuration / 60
                    for try await application in category.applications {
                        pickups += application.numberOfPickups
                        notifications += application.numberOfNotifications
                    }
                }

                let day = dayKey(segment.dateInterval.start)
                let sharedMetadata = [
                    "aggregation": "latest",
                    "lastUpdatedAt": ISO8601DateFormatter().string(from: activity.lastUpdatedDate),
                    "categoryMinutes": categoryMinutes
                        .sorted { $0.value > $1.value }
                        .prefix(8)
                        .map { "\($0.key):\(Int($0.value.rounded()))" }
                        .joined(separator: ","),
                ]
                observations.append(metric(
                    day: day,
                    key: "attention.screen_time_minutes",
                    value: segment.totalActivityDuration / 60,
                    unit: "min",
                    interval: segment.dateInterval,
                    metadata: sharedMetadata
                ))
                observations.append(metric(
                    day: day,
                    key: "attention.longest_session_minutes",
                    value: (segment.longestActivity?.duration ?? 0) / 60,
                    unit: "min",
                    interval: segment.dateInterval
                ))
                observations.append(metric(
                    day: day,
                    key: "attention.pickups",
                    value: Double(pickups),
                    unit: "count",
                    interval: segment.dateInterval
                ))
                observations.append(metric(
                    day: day,
                    key: "attention.notifications",
                    value: Double(notifications),
                    unit: "count",
                    interval: segment.dateInterval
                ))
                if let firstPickup = segment.firstPickup {
                    let components = calendar.dateComponents([.hour, .minute], from: firstPickup)
                    let localHour = Double(components.hour ?? 0)
                        + Double(components.minute ?? 0) / 60
                    observations.append(metric(
                        day: day,
                        key: "attention.first_pickup_local_hour",
                        value: localHour,
                        unit: "local_hour",
                        interval: segment.dateInterval
                    ))
                }
            }
        }
        return observations
    }

    private static func metric(
        day: String,
        key: String,
        value: Double,
        unit: String,
        interval: DateInterval,
        metadata: [String: String] = ["aggregation": "latest"]
    ) -> ContextObservation {
        ContextObservation(
            sourceSystem: "apple_screen_time",
            observationID: "\(day):\(key)",
            metricKey: key,
            observedStart: interval.start,
            observedEnd: interval.end,
            numericValue: value,
            unit: unit,
            metadata: metadata
        )
    }

    private static func dayKey(_ date: Date) -> String {
        date.formatted(.iso8601.year().month().day())
    }
}

enum MusicContextCollector {
    static func collect(limit: Int = 50) async throws -> [ContextObservation] {
        var request = MusicRecentlyPlayedRequest<Song>()
        request.limit = limit
        let response = try await request.response()
        return response.items.compactMap { song in
            guard let playedAt = song.lastPlayedDate else { return nil }
            let duration = song.duration
            let observationID = "\(song.id.rawValue):\(Int(playedAt.timeIntervalSince1970))"
            return ContextObservation(
                sourceSystem: "apple_music",
                observationID: observationID,
                metricKey: "story.music_listening_minutes",
                observedStart: playedAt,
                observedEnd: duration.map { playedAt.addingTimeInterval($0) },
                numericValue: duration.map { $0 / 60 },
                unit: "min",
                textValue: song.title,
                metadata: [
                    "aggregation": "sum",
                    "artist": song.artistName,
                    "album": song.albumTitle ?? "",
                    "genres": song.genreNames.joined(separator: ","),
                    "playCount": song.playCount.map(String.init) ?? "",
                ]
            )
        }
    }
}

@MainActor
final class LocationVisitCollector: NSObject, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let onObservation: (ContextObservation) -> Void

    init(onObservation: @escaping (ContextObservation) -> Void) {
        self.onObservation = onObservation
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    func start() {
        guard CLLocationManager.locationServicesEnabled() else { return }
        manager.startMonitoringVisits()
        manager.requestLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways
            || manager.authorizationStatus == .authorizedWhenInUse {
            start()
        }
    }

    func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        let start = visit.arrivalDate == .distantPast ? nil : visit.arrivalDate
        let end = visit.departureDate == .distantFuture ? nil : visit.departureDate
        guard let start else { return }
        onObservation(locationObservation(
            observationID: "visit:\(placeCell(visit.coordinate)):\(Int(start.timeIntervalSince1970))",
            metricKey: "location.visit",
            coordinate: visit.coordinate,
            start: start,
            end: end,
            accuracy: visit.horizontalAccuracy
        ))
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        onObservation(locationObservation(
            observationID: "snapshot:\(Int(location.timestamp.timeIntervalSince1970 / 3_600))",
            metricKey: "location.snapshot",
            coordinate: location.coordinate,
            start: location.timestamp,
            end: location.timestamp,
            accuracy: location.horizontalAccuracy
        ))
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Location delivery is opportunistic; a future refresh requests another snapshot.
    }

    private func locationObservation(
        observationID: String,
        metricKey: String,
        coordinate: CLLocationCoordinate2D,
        start: Date,
        end: Date?,
        accuracy: CLLocationAccuracy
    ) -> ContextObservation {
        let latitude = rounded(coordinate.latitude)
        let longitude = rounded(coordinate.longitude)
        return ContextObservation(
            sourceSystem: "core_location",
            observationID: observationID,
            metricKey: metricKey,
            observedStart: start,
            observedEnd: end,
            metadata: [
                "aggregation": "latest",
                "latitude": latitude,
                "longitude": longitude,
                "placeCell": "\(latitude),\(longitude)",
                "horizontalAccuracyMeters": String(Int(accuracy.rounded())),
                "coordinatePrecision": "approximately_1km",
            ]
        )
    }

    private func placeCell(_ coordinate: CLLocationCoordinate2D) -> String {
        "\(rounded(coordinate.latitude)),\(rounded(coordinate.longitude))"
    }

    private func rounded(_ value: Double) -> String {
        String(format: "%.2f", value)
    }
}
