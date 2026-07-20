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

final class AppDataStoreTests: XCTestCase {
    @MainActor
    func testLiveBootstrapPersistsAndRestoresOnlyForMatchingAPIOrigin() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let cacheURL = directory.appendingPathComponent("public-bootstrap.json")
        let apiBase = try XCTUnwrap(URL(string: "https://api.texassandfest.example"))
        let responsePayload = publicPayload(
            guide: guide(dateRange: "April 16-18, 2027 - Live"),
            schedule: [scheduleItem(id: "live-schedule")]
        )
        let responseData = try encoded(responsePayload)
        let liveStore = AppDataStore(
            seedPayload: .sample,
            apiBase: apiBase,
            cacheURL: cacheURL,
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        await liveStore.refreshPublicData()

        XCTAssertEqual(liveStore.syncState, .live)
        XCTAssertEqual(liveStore.source, "Live public guide")
        XCTAssertEqual(liveStore.payload.guide.dateRange, "April 16-18, 2027 - Live")
        XCTAssertEqual(liveStore.payload.schedule.map(\.id), ["live-schedule"])
        XCTAssertEqual(liveStore.payload.sponsors.map(\.id), SampleData.sponsors.map(\.id))
        XCTAssertTrue(FileManager.default.fileExists(atPath: cacheURL.path))

        let cachedStore = AppDataStore(
            seedPayload: .sample,
            apiBase: apiBase,
            cacheURL: cacheURL,
            transport: AppDataTransport { _ in throw TestFailure.offline }
        )
        XCTAssertEqual(cachedStore.source, "Cached public guide")
        XCTAssertEqual(cachedStore.payload.schedule.map(\.id), ["live-schedule"])

        await cachedStore.refreshPublicData()

        XCTAssertEqual(cachedStore.syncState, .offline)
        XCTAssertEqual(cachedStore.payload.guide.dateRange, "April 16-18, 2027 - Live")

        let otherOrigin = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://other.texassandfest.example")),
            cacheURL: cacheURL,
            transport: AppDataTransport { _ in throw TestFailure.offline }
        )
        XCTAssertEqual(otherOrigin.source, "Bundled seed")
        XCTAssertEqual(otherOrigin.payload.guide.dateRange, SampleData.guide.dateRange)
    }

    @MainActor
    func testMismatchedEventBootstrapFailsClosedWithoutWritingCache() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let cacheURL = directory.appendingPathComponent("public-bootstrap.json")
        let responsePayload = publicPayload(
            guide: EventGuide(
                id: "texas-sandfest-2028",
                name: "Texas SandFest",
                startDate: "2028-04-14",
                endDate: "2028-04-16",
                dateRange: "April 14-16, 2028",
                timeZone: "America/Chicago",
                location: "Port Aransas beach",
                lastUpdated: Date(timeIntervalSince1970: 1_800_000_000)
            ),
            schedule: [scheduleItem(id: "wrong-event")]
        )
        let responseData = try encoded(responsePayload)
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://api.texassandfest.example")),
            cacheURL: cacheURL,
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        await store.refreshPublicData()

        XCTAssertEqual(store.syncState, .offline)
        XCTAssertEqual(store.payload.guide.id, SampleData.guide.id)
        XCTAssertFalse(FileManager.default.fileExists(atPath: cacheURL.path))
    }

    @MainActor
    func testBoardRuntimeKeepsRichSyntheticScheduleWithLiveOverrides() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let responsePayload = publicPayload(
            guide: guide(dateRange: SampleData.guide.dateRange),
            schedule: [
                ScheduleItem(
                    id: "fri-gates",
                    day: "Friday",
                    time: "9:15 AM",
                    title: "Board gates open",
                    zone: "North Gate",
                    category: "Visitor",
                    stage: nil,
                    artist: nil,
                    endTime: nil,
                    durationMinutes: nil
                ),
                scheduleItem(id: "board-only")
            ],
            runtime: PublicRuntime(mode: "board_demo", label: "Synthetic board data")
        )
        let responseData = try encoded(responsePayload)
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "http://127.0.0.1:8806")),
            cacheURL: directory.appendingPathComponent("public-bootstrap.json"),
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        await store.refreshPublicData()

        XCTAssertEqual(store.syncState, .live)
        XCTAssertEqual(store.source, "Live board demo")
        XCTAssertGreaterThan(store.payload.schedule.count, 10)
        XCTAssertEqual(store.payload.schedule.first(where: { $0.id == "fri-gates" })?.time, "9:15 AM")
        XCTAssertTrue(store.payload.schedule.contains(where: { $0.id == "board-only" }))
        XCTAssertTrue(store.payload.schedule.contains(where: { $0.id == "sat-headliner" }))
    }

    private func publicPayload(
        guide: EventGuide,
        schedule: [ScheduleItem],
        runtime: PublicRuntime? = nil
    ) -> PublicSandFestPayload {
        PublicSandFestPayload(
            guide: guide,
            alert: EmergencyAlert(
                id: "alert-live",
                active: false,
                severity: .info,
                title: "",
                message: "",
                audience: ["public"],
                updatedAt: Date(timeIntervalSince1970: 1_800_000_000),
                expiresAt: nil
            ),
            schedule: schedule,
            zones: [
                PublicVenueZone(
                    id: "north-gate",
                    name: "North Gate",
                    marker: "12.5",
                    summary: "Guest entry"
                )
            ],
            runtime: runtime
        )
    }

    private func guide(dateRange: String) -> EventGuide {
        EventGuide(
            id: SampleData.guide.id,
            name: "Texas SandFest",
            startDate: "2027-04-16",
            endDate: "2027-04-18",
            dateRange: dateRange,
            timeZone: "America/Chicago",
            location: "Port Aransas beach",
            lastUpdated: Date(timeIntervalSince1970: 1_800_000_000)
        )
    }

    private func scheduleItem(id: String) -> ScheduleItem {
        ScheduleItem(
            id: id,
            day: "Friday",
            time: "10:00 AM",
            title: id,
            zone: "Main Stage",
            category: "Music",
            stage: nil,
            artist: nil,
            endTime: nil,
            durationMinutes: nil
        )
    }

    private func encoded(_ payload: PublicSandFestPayload) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(payload)
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("TexasSandFestTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

private enum TestFailure: Error {
    case offline
}
