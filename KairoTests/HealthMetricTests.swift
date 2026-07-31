import XCTest
@testable import Kairo

final class HealthMetricTests: XCTestCase {
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
}
