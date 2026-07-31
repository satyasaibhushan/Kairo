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
        XCTAssertEqual(try ProtectedHealthQueue(fileURL: fileURL, capacity: 5).count, 1)
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
