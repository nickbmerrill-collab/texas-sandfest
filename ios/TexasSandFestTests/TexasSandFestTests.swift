import Foundation
import XCTest
@testable import TexasSandFest

final class LiveTimelineTests: XCTestCase {
    private let guide = EventGuide(
        id: "texas-sandfest-2027",
        name: "Texas SandFest",
        startDate: "2027-04-16",
        endDate: "2027-04-18",
        dateRange: "April 16-18, 2027",
        timeZone: "America/Chicago",
        location: "Port Aransas beach",
        lastUpdated: Date(timeIntervalSince1970: 0)
    )

    func testTimelineUsesEventTimezoneAndOrdersUpcomingItems() throws {
        let active = scheduleItem(id: "active", day: "Friday", time: "11:30 AM", endTime: "12:30 PM")
        let next = scheduleItem(id: "next", day: "Friday", time: "12:45 PM", endTime: "1:15 PM")
        let later = scheduleItem(id: "later", day: "Friday", time: "1:00 PM", endTime: "1:30 PM")
        let reference = try XCTUnwrap(LiveTimeline.date(for: active, guide: guide)).addingTimeInterval(30 * 60)

        let summary = LiveTimeline.summarize([later, active, next], guide: guide, at: reference)

        XCTAssertEqual(summary.nowPlaying.map(\.id), ["active"])
        XCTAssertEqual(summary.upNext.map(\.id), ["next", "later"])
        XCTAssertEqual(LiveTimeline.minutesLeft(for: active, guide: guide, at: reference), 30)
        XCTAssertEqual(LiveTimeline.currentFestivalDay(for: guide, at: reference), "Friday")
    }

    func testEventLabelsComeFromGuideDates() {
        XCTAssertEqual(LiveTimeline.shortDate(for: "Saturday", guide: guide), "Apr 17")
        XCTAssertEqual(LiveTimeline.shortDateRange(for: guide), "Apr 16-18")
        XCTAssertEqual(LiveTimeline.eventYear(for: guide), "2027")
    }

    private func scheduleItem(id: String, day: String, time: String, endTime: String) -> ScheduleItem {
        ScheduleItem(
            id: id,
            day: day,
            time: time,
            title: id,
            zone: "Main Stage",
            category: "Test",
            stage: nil,
            artist: nil,
            endTime: endTime,
            durationMinutes: 30
        )
    }
}

final class UserTicketsStoreTests: XCTestCase {
    @MainActor
    func testQRImportClassifiesDeduplicatesAndPersistsTicket() throws {
        let suiteName = "TexasSandFestTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let fixedDate = Date(timeIntervalSince1970: 1_800_000_000)
        let store = UserTicketsStore(defaults: defaults, defaultsKey: "tickets", now: { fixedDate })

        let first = store.importFromQR("eventeny:vip:ticket-1", eventGuide: SampleData.guide, holderHint: "Board Guest")
        _ = store.importFromQR("eventeny:vip:ticket-1", eventGuide: SampleData.guide)

        XCTAssertEqual(first.band, .threeDayVIP)
        XCTAssertEqual(first.holder, "Board Guest")
        XCTAssertEqual(first.purchaseSource, "Eventeny (scanned)")
        XCTAssertEqual(first.issuedAt, fixedDate)
        XCTAssertEqual(store.imported.map(\.id), [first.id])

        let restored = UserTicketsStore(defaults: defaults, defaultsKey: "tickets")
        XCTAssertEqual(restored.imported.map(\.id), [first.id])
        XCTAssertEqual(restored.imported.first?.band, .threeDayVIP)
    }

    @MainActor
    func testQRImportMapsOperationalPassTypes() throws {
        let suiteName = "TexasSandFestTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let store = UserTicketsStore(defaults: defaults, defaultsKey: "tickets")

        XCTAssertEqual(store.importFromQR("staff:gate-a", eventGuide: SampleData.guide).band, .staff)
        XCTAssertEqual(store.importFromQR("sponsor:marlin", eventGuide: SampleData.guide).band, .sponsor)
        XCTAssertEqual(store.importFromQR("raffle:2027", eventGuide: SampleData.guide).band, .raffle)
        XCTAssertEqual(store.importFromQR("single:friday", eventGuide: SampleData.guide).band, .singleDay)
        XCTAssertEqual(store.importFromQR("general-admission", eventGuide: SampleData.guide).band, .threeDayGA)
    }
}
