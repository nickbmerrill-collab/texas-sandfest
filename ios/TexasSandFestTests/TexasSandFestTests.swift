import Foundation
import XCTest
@testable import TexasSandFest

final class CustomerRouteTests: XCTestCase {
    func testCustomSchemeRoutesOnlyPublicDestinations() throws {
        XCTAssertEqual(
            try route("sandfest://schedule/sat-headliner"),
            .schedule(itemID: "sat-headliner")
        )
        XCTAssertEqual(try route("sandfest://tickets"), .tickets)
        XCTAssertEqual(try route("sandfest://sculptors"), .beach(section: .sculptors))
        XCTAssertEqual(
            try route("sandfest://sandy?question=Where%20is%20ADA%20parking%3F"),
            .sandy(question: "Where is ADA parking?")
        )

        XCTAssertNil(CustomerRoute(url: try url("sandfest://admin")))
        XCTAssertNil(CustomerRoute(url: try url("sandfest://incident/private-1")))
        XCTAssertNil(CustomerRoute(url: try url("sandfest://schedule/../../admin")))
    }

    func testCanonicalHTTPSRoutesAndRejectsOtherOrigins() throws {
        XCTAssertEqual(
            try route("https://sandfest.heyelab.com/schedule/fri-gates"),
            .schedule(itemID: "fri-gates")
        )
        XCTAssertEqual(
            try route("https://sandfest.heyelab.com/#island-conditions"),
            .beach(section: .live)
        )
        XCTAssertEqual(try route("https://sandfest.heyelab.com/"), .today)

        XCTAssertNil(CustomerRoute(url: try url("http://sandfest.heyelab.com/tickets")))
        XCTAssertNil(CustomerRoute(url: try url("https://evil.example/tickets")))
        XCTAssertNil(CustomerRoute(url: try url("https://sandfest.heyelab.com:444/tickets")))
    }

    func testQuestionsAndScheduleIdentifiersAreBounded() throws {
        let oversizedQuestion = String(repeating: "a", count: 281)
        var components = URLComponents(string: "sandfest://sandy")
        components?.queryItems = [URLQueryItem(name: "question", value: oversizedQuestion)]
        let oversizedURL = try XCTUnwrap(components?.url)
        XCTAssertEqual(CustomerRoute(url: oversizedURL)?.destination, .sandy(question: nil))
        XCTAssertEqual(
            CustomerRoute(url: try url("sandfest://sandy?question=go%0Anow"))?.destination,
            .sandy(question: nil)
        )

        let oversizedID = String(repeating: "a", count: 101)
        XCTAssertNil(CustomerRoute(url: try url("sandfest://schedule/\(oversizedID)")))
        XCTAssertNil(CustomerRoute(url: try url("sandfest://schedule/not%20safe")))
    }

    func testLaunchArgumentUsesTheSameParser() throws {
        let route = CustomerRoute.launchRoute(
            arguments: ["TexasSandFest", "-deepLink", "sandfest://tickets"]
        )
        XCTAssertEqual(route?.destination, .tickets)
        XCTAssertNil(CustomerRoute.launchRoute(arguments: ["TexasSandFest", "-deepLink", "sandfest://admin"]))
        XCTAssertNil(CustomerRoute.launchRoute(arguments: ["TexasSandFest"]))
    }

    private func route(_ value: String) throws -> CustomerDestination {
        try XCTUnwrap(CustomerRoute(url: url(value))).destination
    }

    private func url(_ value: String) throws -> URL {
        try XCTUnwrap(URL(string: value))
    }
}

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

final class FleetStoreTests: XCTestCase {
    @MainActor
    func testAuthenticatedRefreshAndCheckoutApplyServerFleetTruth() async throws {
        var availableAsset = try XCTUnwrap(FleetSampleData.assets.first(where: { $0.id == "cart-02" }))
        let dashboard = FleetDashboardPayload(
            lastUpdated: "2026-07-22T01:00:00.000Z",
            eventId: SampleData.guide.id,
            summary: FleetSummary(
                totals: FleetTotals(
                    assets: 1,
                    available: 1,
                    checkedOut: 0,
                    maintenance: 0,
                    openCheckouts: 0,
                    withTracker: 1,
                    withLiveLocation: 0,
                    rentalCostCents: 45_000,
                    damageReports: 0
                ),
                byStatus: ["available": 1],
                byType: ["golf_cart": 1],
                teams: [:]
            ),
            assets: [availableAsset],
            openCheckouts: []
        )
        let dashboardData = try JSONEncoder().encode(dashboard)
        availableAsset.status = "checked_out"
        availableAsset.activeCheckout = FleetCheckout(
            id: "checkout-live",
            assetId: availableAsset.id,
            checkedOutTo: "Board Runner",
            team: "site-ops",
            method: "ios_scan"
        )
        let mutationData = try JSONEncoder().encode(FleetMutationTestPayload(asset: availableAsset))
        let recorder = AppDataRequestRecorder()
        let store = FleetStore(
            seed: [],
            transport: AppDataTransport { request in
                await recorder.record(request)
                if request.httpMethod == "POST" {
                    return AppDataHTTPResponse(data: mutationData, statusCode: 200)
                }
                return AppDataHTTPResponse(data: dashboardData, statusCode: 200)
            }
        )
        var refreshRequest = URLRequest(url: try XCTUnwrap(URL(string: "http://127.0.0.1:8806/api/admin/fleet")))
        refreshRequest.setValue("Bearer local-board-secret", forHTTPHeaderField: "Authorization")

        await store.refreshFromAPI(request: refreshRequest)

        XCTAssertEqual(store.source, "Live board fleet")
        XCTAssertEqual(store.assets.map(\.id), ["cart-02"])
        var checkoutRequest = refreshRequest
        checkoutRequest.httpMethod = "POST"
        let error = await store.postCheckout(
            assetId: "cart-02",
            checkedOutTo: "Board Runner",
            team: "site-ops",
            startChargePct: 92,
            request: checkoutRequest
        )

        XCTAssertNil(error)
        XCTAssertEqual(store.assets.first?.activeCheckout?.checkedOutTo, "Board Runner")
        let requests = await recorder.values()
        XCTAssertEqual(requests.map(\.method), ["GET", "POST"])
        XCTAssertTrue(requests.allSatisfy { $0.authorization == "Bearer local-board-secret" })
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: requests[1].body) as? [String: Any])
        XCTAssertEqual(body["assetId"] as? String, "cart-02")
        XCTAssertEqual(body["startChargePct"] as? Int, 92)
    }

    @MainActor
    func testMissingBoardSessionNeverMutatesFleetLocally() async throws {
        let original = try XCTUnwrap(FleetSampleData.assets.first(where: { $0.id == "cart-02" }))
        let store = FleetStore(seed: [original])

        await store.refreshFromAPI(request: nil)
        let error = await store.postCheckout(
            assetId: original.id,
            checkedOutTo: "Should Not Persist",
            team: "site-ops",
            startChargePct: 100,
            request: nil
        )

        XCTAssertEqual(store.source, "Sample seed - board session required")
        XCTAssertEqual(store.lastError, "Authenticated board Fleet access is unavailable.")
        XCTAssertEqual(store.assets.first?.status, "available")
        XCTAssertTrue(error?.contains("no fleet state was changed") == true)
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
        XCTAssertEqual(liveStore.staffAccessMode, .visitorOnly)
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
        XCTAssertEqual(cachedStore.staffAccessMode, .visitorOnly)
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
        XCTAssertEqual(otherOrigin.staffAccessMode, .visitorOnly)
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
    func testEmptyPublishedScheduleClearsBundledSampleProgramming() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let responsePayload = publicPayload(
            guide: guide(dateRange: SampleData.guide.dateRange),
            schedule: []
        )
        let responseData = try encoded(responsePayload)
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://api.texassandfest.example")),
            cacheURL: directory.appendingPathComponent("public-bootstrap.json"),
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        XCTAssertFalse(store.payload.schedule.isEmpty)
        await store.refreshPublicData()

        XCTAssertEqual(store.syncState, .live)
        XCTAssertEqual(store.source, "Live public guide")
        XCTAssertTrue(store.payload.schedule.isEmpty)
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
        XCTAssertEqual(store.staffAccessMode, .boardDemo)
        XCTAssertGreaterThan(store.payload.schedule.count, 10)
        XCTAssertEqual(store.payload.schedule.first(where: { $0.id == "fri-gates" })?.time, "9:15 AM")
        XCTAssertTrue(store.payload.schedule.contains(where: { $0.id == "board-only" }))
        XCTAssertTrue(store.payload.schedule.contains(where: { $0.id == "sat-headliner" }))

        let cachedStore = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "http://127.0.0.1:8806")),
            cacheURL: directory.appendingPathComponent("public-bootstrap.json"),
            transport: AppDataTransport { _ in throw TestFailure.offline }
        )
        XCTAssertEqual(cachedStore.staffAccessMode, .boardDemo)

        let remoteStore = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://sandfest-api.example.com")),
            cacheURL: nil,
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )
        await remoteStore.refreshPublicData()
        XCTAssertEqual(remoteStore.syncState, .live)
        XCTAssertEqual(remoteStore.staffAccessMode, .visitorOnly)
    }

    @MainActor
    func testBoardRuntimeLoadsAuthenticatedOperationsWithoutCachingPrivateData() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let cacheURL = directory.appendingPathComponent("public-bootstrap.json")
        let publicResponse = try encoded(publicPayload(
            guide: guide(dateRange: SampleData.guide.dateRange),
            schedule: [scheduleItem(id: "board-live")],
            runtime: PublicRuntime(mode: "board_demo", label: "Synthetic board data")
        ))
        let adminResponse = Data(#"""
        {
          "eventId": "texas-sandfest-2027",
          "partners": {
            "taskSummary": { "active": 7, "overdue": 1, "blocked": 2, "unassigned": 0 },
            "sponsors": [{
              "id": "sponsor-live",
              "name": "Live Sponsor",
              "tier": "Marlin",
              "expectedCents": 1500000,
              "paidCents": 1000000,
              "balanceCents": 500000,
              "invoiceStatus": "approved",
              "deliverablesTotal": 8,
              "deliverablesComplete": 3,
              "nextAction": "Approve stage banner"
            }],
            "vendors": [{
              "id": "vendor-live",
              "name": "Live Vendor",
              "category": "food",
              "readinessStatus": "blocked",
              "missingRequirements": 2,
              "boothNumber": null
            }]
          },
          "volunteers": {
            "coverage": [{ "id": "north", "zone": "North Gate", "filled": 18, "needed": 22 }]
          },
          "finance": {
            "quickbooks": {
              "connected": false,
              "environment": "sandbox",
              "invoiceSyncEnabled": false,
              "canSyncPartnerInvoices": false,
              "reason": "QuickBooks invoice sync is disabled."
            },
            "receivables": {
              "amountExpectedCents": 2800000,
              "amountPaidCents": 1000000,
              "balanceCents": 1800000,
              "overdueCents": 0
            },
            "budget": {
              "totals": { "budgetCents": 53000000, "committedCents": 18640000, "remainingCents": 34360000 },
              "counts": { "pendingApprovals": 2 }
            },
            "revenue": {
              "totals": { "grossCents": 1750000, "netCents": 1722575 },
              "reconciliation": { "pctReconciled": 75 }
            }
          }
        }
        """#.utf8)
        let recorder = AppDataRequestRecorder()
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "http://127.0.0.1:8806")),
            cacheURL: cacheURL,
            boardAdminToken: "local-board-secret",
            transport: AppDataTransport { request in
                await recorder.record(request)
                switch request.url?.path {
                case "/api/public/bootstrap":
                    return AppDataHTTPResponse(data: publicResponse, statusCode: 200)
                case "/api/admin/app-bootstrap":
                    return AppDataHTTPResponse(data: adminResponse, statusCode: 200)
                default:
                    throw TestFailure.offline
                }
            }
        )

        await store.refreshPublicData()

        XCTAssertEqual(store.staffAccessMode, .boardDemo)
        XCTAssertEqual(store.adminSyncState, .live)
        XCTAssertEqual(store.adminSource, "Live board operations")
        XCTAssertEqual(store.adminTaskSummary, AdminTaskSummary(active: 7, overdue: 1, blocked: 2, unassigned: 0))
        XCTAssertEqual(store.payload.sponsors.map(\.name), ["Live Sponsor"])
        XCTAssertEqual(store.payload.sponsors.first?.invoiceStatus, "Approved - $5,000 due")
        XCTAssertEqual(store.payload.vendors.first?.status, "Blocked - 2 requirements missing")
        XCTAssertEqual(store.payload.coverage.first?.filled, 18)
        XCTAssertEqual(store.payload.financeSignals.map(\.id), ["quickbooks", "receivables", "revenue", "budget"])

        let fleetRequest = try XCTUnwrap(store.makeBoardAdminRequest(path: "/api/admin/fleet"))
        XCTAssertEqual(fleetRequest.url?.absoluteString, "http://127.0.0.1:8806/api/admin/fleet")
        XCTAssertEqual(fleetRequest.httpMethod, "GET")
        XCTAssertEqual(fleetRequest.value(forHTTPHeaderField: "Authorization"), "Bearer local-board-secret")
        XCTAssertNil(store.makeBoardAdminRequest(path: "/api/public/bootstrap"))

        let requests = await recorder.values()
        XCTAssertEqual(requests.map(\.path), ["/api/public/bootstrap", "/api/admin/app-bootstrap"])
        XCTAssertNil(requests[0].authorization)
        XCTAssertEqual(requests[1].authorization, "Bearer local-board-secret")
        let cachedText = try String(contentsOf: cacheURL, encoding: .utf8)
        XCTAssertFalse(cachedText.contains("local-board-secret"))
        XCTAssertFalse(cachedText.contains("Live Sponsor"))
    }

    @MainActor
    func testRemoteBoardLabelNeverRequestsAuthenticatedOperations() async throws {
        let publicResponse = try encoded(publicPayload(
            guide: guide(dateRange: SampleData.guide.dateRange),
            schedule: [scheduleItem(id: "remote-board-label")],
            runtime: PublicRuntime(mode: "board_demo", label: "Synthetic board data")
        ))
        let recorder = AppDataRequestRecorder()
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://sandfest-api.example.com")),
            cacheURL: nil,
            boardAdminToken: "must-not-leave-device",
            transport: AppDataTransport { request in
                await recorder.record(request)
                return AppDataHTTPResponse(data: publicResponse, statusCode: 200)
            }
        )

        await store.refreshPublicData()

        let requests = await recorder.values()
        XCTAssertEqual(store.staffAccessMode, .visitorOnly)
        XCTAssertEqual(store.adminSource, "Bundled admin demo")
        XCTAssertNil(store.makeBoardAdminRequest(path: "/api/admin/fleet"))
        XCTAssertEqual(requests.map(\.path), ["/api/public/bootstrap"])
        XCTAssertTrue(requests.allSatisfy { $0.authorization == nil })
    }

    @MainActor
    func testConciergePostsBoundedQuestionAndReturnsSourceCitedAnswer() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let recorder = ConciergeRequestRecorder()
        let responsePayload = PublicConciergeResponse(
            answer: "Published accessibility help is available at North Gate.",
            topic: "accessibility",
            confidence: .high,
            escalated: false,
            sources: [
                PublicConciergeSource(
                    id: "accessibility-locations",
                    label: "Published accessibility locations",
                    href: "#operations",
                    updatedAt: "2026-07-17T00:00:00.000Z"
                )
            ],
            suggestions: ["Is parking information available?"]
        )
        let responseData = try encoded(responsePayload)
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://api.texassandfest.example")),
            cacheURL: directory.appendingPathComponent("public-bootstrap.json"),
            transport: AppDataTransport { request in
                await recorder.record(request)
                return AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        let answer = try await store.askSandy("  What accessibility services are available?  ")
        let recordedRequest = await recorder.value()
        let request = try XCTUnwrap(recordedRequest)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: request.body) as? [String: String]
        )

        XCTAssertEqual(answer.topic, "accessibility")
        XCTAssertEqual(answer.confidence, .high)
        XCTAssertEqual(answer.sources.map(\.href), ["#operations"])
        XCTAssertEqual(request.url, "https://api.texassandfest.example/api/public/concierge")
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.accept, "application/json")
        XCTAssertEqual(request.contentType, "application/json")
        XCTAssertEqual(request.cachePolicy, URLRequest.CachePolicy.reloadIgnoringLocalCacheData.rawValue)
        XCTAssertEqual(body["question"], "What accessibility services are available?")
    }

    @MainActor
    func testConciergeRejectsUnsafeSourcesAndInvalidQuestions() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let unsafeResponse = PublicConciergeResponse(
            answer: "Unsafe answer",
            topic: "unknown",
            confidence: .low,
            escalated: true,
            sources: [
                PublicConciergeSource(
                    id: "unsafe",
                    label: "Unsafe source",
                    href: "http://private.example/source",
                    updatedAt: nil
                )
            ],
            suggestions: []
        )
        let responseData = try encoded(unsafeResponse)
        let store = AppDataStore(
            seedPayload: .sample,
            apiBase: try XCTUnwrap(URL(string: "https://api.texassandfest.example")),
            cacheURL: directory.appendingPathComponent("public-bootstrap.json"),
            transport: AppDataTransport { _ in
                AppDataHTTPResponse(data: responseData, statusCode: 200)
            }
        )

        do {
            _ = try await store.askSandy("Where should I go?")
            XCTFail("An insecure concierge source should fail validation.")
        } catch AppDataError.invalidConciergeResponse {
            // Expected.
        } catch {
            XCTFail("Unexpected concierge error: \(error)")
        }

        do {
            _ = try await store.askSandy("x")
            XCTFail("A one-character question should fail before transport.")
        } catch AppDataError.invalidQuestion {
            // Expected.
        } catch {
            XCTFail("Unexpected question error: \(error)")
        }
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

    private func encoded<T: Encodable>(_ payload: T) throws -> Data {
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

private struct ConciergeRequestSnapshot: Sendable {
    let url: String
    let method: String
    let accept: String?
    let contentType: String?
    let cachePolicy: UInt
    let body: Data
}

private actor ConciergeRequestRecorder {
    private var snapshot: ConciergeRequestSnapshot?

    func record(_ request: URLRequest) {
        snapshot = ConciergeRequestSnapshot(
            url: request.url?.absoluteString ?? "",
            method: request.httpMethod ?? "",
            accept: request.value(forHTTPHeaderField: "Accept"),
            contentType: request.value(forHTTPHeaderField: "Content-Type"),
            cachePolicy: request.cachePolicy.rawValue,
            body: request.httpBody ?? Data()
        )
    }

    func value() -> ConciergeRequestSnapshot? {
        snapshot
    }
}

private struct AppDataRequestSnapshot: Sendable {
    let path: String
    let method: String
    let authorization: String?
    let body: Data
}

private actor AppDataRequestRecorder {
    private var snapshots: [AppDataRequestSnapshot] = []

    func record(_ request: URLRequest) {
        snapshots.append(AppDataRequestSnapshot(
            path: request.url?.path ?? "",
            method: request.httpMethod ?? "GET",
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            body: request.httpBody ?? Data()
        ))
    }

    func values() -> [AppDataRequestSnapshot] {
        snapshots
    }
}

private struct FleetMutationTestPayload: Encodable {
    let asset: FleetAsset
}
