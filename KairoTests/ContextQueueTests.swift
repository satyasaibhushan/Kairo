import Foundation
import XCTest
@testable import Kairo

final class ContextQueueTests: XCTestCase {
    func testQueueDeduplicatesAndAcknowledgesObservations() throws {
        let fileURL = temporaryFileURL()
        let queue = try ProtectedContextQueue(fileURL: fileURL, capacity: 3)
        let original = observation(id: "one", value: 10)
        let replacement = observation(id: "one", value: 20)
        let second = observation(id: "two", value: 30)

        try queue.enqueue([original, replacement, second])

        XCTAssertEqual(queue.count, 2)
        XCTAssertEqual(queue.nextBatch(limit: 1).first?.numericValue, 20)
        try queue.acknowledge(ids: [replacement.id])
        XCTAssertEqual(queue.nextBatch(limit: 10).map(\.observationID), ["two"])
    }

    func testQueueRefusesToDiscardDataWhenCapacityIsReached() throws {
        let queue = try ProtectedContextQueue(fileURL: temporaryFileURL(), capacity: 1)
        try queue.enqueue([observation(id: "one", value: 10)])

        XCTAssertThrowsError(try queue.enqueue([observation(id: "two", value: 20)]))
        XCTAssertEqual(queue.nextBatch(limit: 10).map(\.observationID), ["one"])
    }

    private func observation(id: String, value: Double) -> ContextObservation {
        ContextObservation(
            sourceSystem: "test",
            observationID: id,
            metricKey: "test.value",
            observedStart: Date(timeIntervalSince1970: value),
            numericValue: value,
            unit: "count"
        )
    }

    private func temporaryFileURL() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent("context.json")
    }
}
