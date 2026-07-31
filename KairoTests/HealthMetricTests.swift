import XCTest
@testable import Kairo

final class HealthMetricTests: XCTestCase {
    func testHealthCatalogCoversTheCompleteStandardSDKSurface() {
        XCTAssertEqual(HealthDataCatalog.declaredTypeCount, 205)
        XCTAssertGreaterThanOrEqual(HealthDataCatalog.availableTypeCount, 200)
        XCTAssertEqual(
            HealthDataCatalog.sampleTypes.count,
            HealthDataCatalog.availableTypeCount - 7
        )
    }

    func testEveryMetricHasAReadableTitleAndSymbol() {
        for metric in HealthMetric.allCases {
            XCTAssertFalse(metric.title.isEmpty)
            XCTAssertFalse(metric.symbol.isEmpty)
        }
    }

    func testUnavailableReadingPreservesMetricIdentity() {
        let reading = HealthReading.unavailable(.sleep)

        XCTAssertEqual(reading.id, .sleep)
        XCTAssertEqual(reading.value, "—")
        XCTAssertNil(reading.measuredAt)
    }

    func testSnapshotContainsEverySupportedMetricByDefault() {
        XCTAssertEqual(
            Set(HealthSnapshot.empty.readings.map(\.metric)),
            Set(HealthMetric.allCases)
        )
    }

    func testProtectedQueueDeduplicatesAndPersistsChanges() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let fileURL = directory.appendingPathComponent("queue.json")
        let sampleID = UUID()
        let upsert = makeChange(sampleID: sampleID, operation: .upsert)
        let deletion = makeChange(sampleID: sampleID, operation: .delete)

        let queue = try ProtectedHealthQueue(fileURL: fileURL, capacity: 5)
        try queue.enqueue([upsert, upsert])
        XCTAssertEqual(queue.count, 1)

        try queue.enqueue([deletion])
        XCTAssertEqual(queue.count, 1)
        try queue.acknowledge(ids: [deletion.id])
        XCTAssertEqual(queue.count, 0)
        XCTAssertEqual(try ProtectedHealthQueue(fileURL: fileURL, capacity: 5).count, 0)
    }

    func testProtectedQueueRefusesToDropChangesAtCapacity() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let queue = try ProtectedHealthQueue(
            fileURL: directory.appendingPathComponent("queue.json"),
            capacity: 1
        )

        try queue.enqueue([makeChange(sampleID: UUID(), operation: .upsert)])
        XCTAssertThrowsError(
            try queue.enqueue([makeChange(sampleID: UUID(), operation: .upsert)])
        )
        XCTAssertEqual(queue.count, 1)
    }

    func testPairingCodeRequiresHTTPSAndDecodesCredentials() throws {
        let payload: [String: String] = [
            "endpoint": "https://kairo.example/api/health/changes",
            "ingestToken": "ingest-secret",
            "siteAccessToken": "site-secret",
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let code = data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")

        let configuration = try HealthSyncConfiguration(pairingCode: code)

        XCTAssertEqual(configuration.endpoint.absoluteString, payload["endpoint"])
        XCTAssertEqual(configuration.ingestToken, payload["ingestToken"])
        XCTAssertEqual(configuration.siteAccessToken, payload["siteAccessToken"])
    }

    func testUploadingStatusReportsAcknowledgedProgress() {
        let status = HealthSyncStatus.uploading(sent: 250, total: 1_000)

        XCTAssertEqual(status.label, "UPLOADING 25%")
        XCTAssertEqual(status.detail, "250 of 1,000 changes acknowledged.")
    }

    func testHistoricalBackfillKeepsTheCurrentStreamUntilItsFinalPage() {
        let cutoff = Date(timeIntervalSince1970: 100)
        var progress = HealthBackfillProgress(
            cutoff: cutoff,
            typeIdentifiers: ["heart-rate", "sleep"],
            updatedAt: cutoff
        )

        progress.recordPage(
            typeIdentifier: "heart-rate",
            changes: 250,
            completedType: false,
            at: cutoff
        )
        XCTAssertEqual(progress.nextTypeIdentifier, "heart-rate")

        progress.recordPage(
            typeIdentifier: "heart-rate",
            changes: 17,
            completedType: true,
            at: cutoff
        )
        XCTAssertEqual(progress.nextTypeIdentifier, "sleep")
        XCTAssertEqual(progress.importedChanges, 267)
        XCTAssertEqual(progress.fractionComplete, 0.5)
    }

    func testHistoricalBackfillProgressPersistsAcrossLaunches() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = HealthBackfillProgressStore(
            fileURL: directory.appendingPathComponent("backfill.json")
        )
        let cutoff = Date(timeIntervalSince1970: 100)
        var progress = HealthBackfillProgress(
            cutoff: cutoff,
            typeIdentifiers: ["weight"],
            updatedAt: cutoff
        )
        progress.recordPage(
            typeIdentifier: "weight",
            changes: 3,
            completedType: true,
            at: cutoff
        )

        try store.save(progress)

        XCTAssertEqual(try store.load(), progress)
        XCTAssertTrue(try XCTUnwrap(store.load()).isComplete)
    }

    private func makeChange(
        sampleID: UUID,
        operation: HealthChangeOperation
    ) -> HealthChange {
        HealthChange(
            id: "\(operation.rawValue):\(sampleID.uuidString)",
            operation: operation,
            sampleID: sampleID,
            typeIdentifier: "test.type",
            startDate: operation == .upsert ? Date(timeIntervalSince1970: 1) : nil,
            endDate: operation == .upsert ? Date(timeIntervalSince1970: 2) : nil,
            numericValue: 1,
            unit: "count",
            categoryValue: nil,
            sourceName: "Tests",
            sourceBundleIdentifier: "com.example.tests",
            sourceVersion: "1",
            deviceName: "iPhone",
            deviceModel: "Test",
            deviceManufacturer: "Apple",
            metadata: [:]
        )
    }
}
