import Foundation

struct AppDataHTTPResponse: Sendable {
    let data: Data
    let statusCode: Int
}

struct AppDataTransport: Sendable {
    let load: @Sendable (URLRequest) async throws -> AppDataHTTPResponse

    static let live = AppDataTransport { request in
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppDataError.invalidResponse
        }
        return AppDataHTTPResponse(data: data, statusCode: httpResponse.statusCode)
    }
}

private struct PublicBootstrapCache: Codable {
    let schemaVersion: Int
    let apiScope: String
    let eventID: String
    let savedAt: Date
    let payload: PublicSandFestPayload
}

private struct ConciergeQuestion: Encodable {
    let question: String
}

@MainActor
final class AppDataStore: ObservableObject {
    @Published private(set) var payload: SandFestPayload
    @Published private(set) var alert: EmergencyAlert
    @Published private(set) var source: String
    @Published private(set) var syncState: SyncState = .cached

    private let bundledPayload: SandFestPayload
    private let resolvedAPIBase: URL
    private let cacheURL: URL?
    private let transport: AppDataTransport

    init(
        seedPayload: SandFestPayload? = nil,
        apiBase: URL? = nil,
        cacheURL: URL? = nil,
        transport: AppDataTransport = .live
    ) {
        let seedResult = Self.seedResult(seedPayload: seedPayload)
        let resolvedAPIBase = apiBase ?? Self.apiBase
        let resolvedCacheURL = cacheURL ?? Self.defaultCacheURL()

        bundledPayload = seedResult.payload
        self.resolvedAPIBase = resolvedAPIBase
        self.cacheURL = resolvedCacheURL
        self.transport = transport

        if let cached = Self.loadCachedBootstrap(
            from: resolvedCacheURL,
            apiBase: resolvedAPIBase,
            expectedEventID: seedResult.payload.guide.id
        ) {
            let merged = Self.merge(cached, into: seedResult.payload)
            payload = merged
            alert = merged.alert
            source = Self.sourceLabel(for: cached, cached: true)
        } else {
            payload = seedResult.payload
            alert = seedResult.payload.alert
            source = seedResult.source
        }
    }

    /// Resolved API base, in priority order:
    /// 1. CommandLine `-apiBase URL` (handy for demos / local routing)
    /// 2. `SANDFEST_API_BASE` env var (CI / TestFlight builds)
    /// 3. Info.plist `SandFestAPIBase` (per-config plist override)
    /// 4. https://sandfest-api.heyelab.com (production default)
    /// 5. http://127.0.0.1:8788 (debug fallback when running against local API)
    static var apiBase: URL {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-apiBase"), i + 1 < args.count,
           let url = URL(string: args[i + 1]) { return url }
        if let env = ProcessInfo.processInfo.environment["SANDFEST_API_BASE"],
           let url = URL(string: env) { return url }
        if let plist = Bundle.main.object(forInfoDictionaryKey: "SandFestAPIBase") as? String,
           let url = URL(string: plist) { return url }
        #if DEBUG
        return URL(string: "http://127.0.0.1:8788")!
        #else
        return URL(string: "https://sandfest-api.heyelab.com")!
        #endif
    }

    func refreshPublicData(apiBase: URL? = nil) async {
        guard syncState != .refreshing else { return }

        let targetBase = apiBase ?? resolvedAPIBase
        syncState = .refreshing

        do {
            var request = URLRequest(url: Self.publicBootstrapURL(apiBase: targetBase))
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 12
            request.setValue("application/json", forHTTPHeaderField: "Accept")

            let response = try await transport.load(request)
            guard response.statusCode == 200 else {
                throw AppDataError.httpStatus(response.statusCode)
            }

            let publicPayload = try Self.decoder.decode(PublicSandFestPayload.self, from: response.data)
            try Self.validate(publicPayload, expectedEventID: bundledPayload.guide.id)

            let merged = Self.merge(publicPayload, into: bundledPayload)
            payload = merged
            alert = merged.alert
            source = Self.sourceLabel(for: publicPayload, cached: false)
            syncState = .live
            Self.persist(publicPayload, to: cacheURL, apiBase: targetBase)
        } catch {
            syncState = .offline
        }
    }

    func askSandy(_ questionInput: String, apiBase: URL? = nil) async throws -> PublicConciergeResponse {
        let question = questionInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...280).contains(question.count) else {
            throw AppDataError.invalidQuestion
        }

        let targetBase = apiBase ?? resolvedAPIBase
        var request = URLRequest(url: Self.publicURL(apiBase: targetBase, path: ["api", "public", "concierge"]))
        request.httpMethod = "POST"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 12
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try Self.encoder.encode(ConciergeQuestion(question: question))

        let response = try await transport.load(request)
        guard response.statusCode == 200 else {
            throw AppDataError.httpStatus(response.statusCode)
        }
        let answer = try Self.decoder.decode(PublicConciergeResponse.self, from: response.data)
        try Self.validate(answer)
        return answer
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func seedResult(seedPayload: SandFestPayload?) -> (payload: SandFestPayload, source: String) {
        let fallback = SandFestPayload.sample
        let loaded: SandFestPayload

        if let seedPayload {
            loaded = seedPayload
        } else {
            do {
                loaded = try loadSeedPayload()
            } catch {
                return (fallback, "Fallback sample")
            }
        }

        // The governed bootstrap is intentionally sparse until the final public
        // lineup is approved. Keep the richer local schedule for the offline and
        // explicitly labeled board experience only.
        let needsRichSchedule = loaded.schedule.count < 10
        let merged = SandFestPayload(
            guide: loaded.guide,
            alert: loaded.alert,
            schedule: needsRichSchedule ? SampleData.schedule : loaded.schedule,
            zones: loaded.zones,
            ticketOptions: loaded.ticketOptions,
            sponsors: loaded.sponsors,
            vendors: loaded.vendors,
            coverage: loaded.coverage,
            financeSignals: loaded.financeSignals,
            myTickets: loaded.myTickets ?? SampleData.myTickets
        )
        return (merged, needsRichSchedule ? "Bundled seed (sample schedule overlay)" : "Bundled seed")
    }

    private static func validate(_ publicPayload: PublicSandFestPayload, expectedEventID: String) throws {
        guard publicPayload.guide.id == expectedEventID else {
            throw AppDataError.eventMismatch(expected: expectedEventID, received: publicPayload.guide.id)
        }
        guard !publicPayload.guide.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !publicPayload.guide.dateRange.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !publicPayload.guide.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AppDataError.invalidBootstrap
        }
        guard !publicPayload.schedule.isEmpty,
              Set(publicPayload.schedule.map(\.id)).count == publicPayload.schedule.count,
              publicPayload.schedule.allSatisfy({ !$0.id.isEmpty && !$0.title.isEmpty }) else {
            throw AppDataError.invalidBootstrap
        }
        guard !publicPayload.zones.isEmpty,
              Set(publicPayload.zones.map(\.id)).count == publicPayload.zones.count,
              publicPayload.zones.allSatisfy({ !$0.id.isEmpty && !$0.name.isEmpty }) else {
            throw AppDataError.invalidBootstrap
        }
        guard !publicPayload.alert.id.isEmpty,
              !publicPayload.alert.active || publicPayload.alert.audience.contains("public") else {
            throw AppDataError.invalidBootstrap
        }
        if let runtime = publicPayload.runtime, runtime.mode != "board_demo" {
            throw AppDataError.invalidBootstrap
        }
    }

    private static func validate(_ answer: PublicConciergeResponse) throws {
        let answerText = answer.answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !answerText.isEmpty,
              answerText.count <= 2_000,
              !answer.topic.isEmpty,
              (1...4).contains(answer.sources.count),
              Set(answer.sources.map(\.id)).count == answer.sources.count,
              answer.sources.allSatisfy({ source in
                  !source.id.isEmpty
                      && !source.label.isEmpty
                      && validConciergeHref(source.href)
              }),
              answer.suggestions.count <= 4,
              Set(answer.suggestions).count == answer.suggestions.count,
              answer.suggestions.allSatisfy({ !$0.isEmpty && $0.count <= 120 }) else {
            throw AppDataError.invalidConciergeResponse
        }
    }

    private static func validConciergeHref(_ href: String) -> Bool {
        if href.range(of: #"^#[A-Za-z][A-Za-z0-9_-]*$"#, options: .regularExpression) != nil {
            return true
        }
        guard let url = URL(string: href) else { return false }
        return url.scheme?.lowercased() == "https" && url.host != nil
    }

    private static func merge(_ publicPayload: PublicSandFestPayload, into bundled: SandFestPayload) -> SandFestPayload {
        let boardDemo = publicPayload.runtime?.mode == "board_demo"
        let schedule = boardDemo
            ? mergeBoardSchedule(publicPayload.schedule, fallback: bundled.schedule)
            : publicPayload.schedule
        let zonesByID = Dictionary(uniqueKeysWithValues: bundled.zones.map { ($0.id, $0) })
        let zones = publicPayload.zones.map { publicZone in
            let bundledZone = zonesByID[publicZone.id]
            return VenueZone(
                id: publicZone.id,
                name: publicZone.name,
                marker: publicZone.marker ?? bundledZone?.marker ?? "",
                summary: publicZone.summary ?? bundledZone?.summary ?? "",
                status: bundledZone?.status ?? .normal
            )
        }

        return SandFestPayload(
            guide: publicPayload.guide,
            alert: publicPayload.alert,
            schedule: schedule,
            zones: zones,
            ticketOptions: bundled.ticketOptions,
            sponsors: bundled.sponsors,
            vendors: bundled.vendors,
            coverage: bundled.coverage,
            financeSignals: bundled.financeSignals,
            myTickets: bundled.myTickets
        )
    }

    private static func mergeBoardSchedule(_ live: [ScheduleItem], fallback: [ScheduleItem]) -> [ScheduleItem] {
        let liveByID = Dictionary(uniqueKeysWithValues: live.map { ($0.id, $0) })
        let fallbackIDs = Set(fallback.map(\.id))
        let mergedFallback = fallback.map { fallbackItem in
            guard let liveItem = liveByID[fallbackItem.id] else { return fallbackItem }
            return ScheduleItem(
                id: liveItem.id,
                day: liveItem.day,
                time: liveItem.time,
                title: liveItem.title,
                zone: liveItem.zone,
                category: liveItem.category,
                stage: fallbackItem.stage,
                artist: fallbackItem.artist,
                endTime: fallbackItem.endTime,
                durationMinutes: fallbackItem.durationMinutes
            )
        }
        return mergedFallback + live.filter { !fallbackIDs.contains($0.id) }
    }

    private static func sourceLabel(for payload: PublicSandFestPayload, cached: Bool) -> String {
        if payload.runtime?.mode == "board_demo" {
            return cached ? "Cached board demo" : "Live board demo"
        }
        return cached ? "Cached public guide" : "Live public guide"
    }

    private static func publicBootstrapURL(apiBase: URL) -> URL {
        publicURL(apiBase: apiBase, path: ["api", "public", "bootstrap"])
    }

    private static func publicURL(apiBase: URL, path: [String]) -> URL {
        path.reduce(apiBase) { url, component in
            url.appendingPathComponent(component)
        }
    }

    private static func defaultCacheURL() -> URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("TexasSandFest", isDirectory: true)
            .appendingPathComponent("public-bootstrap-v1.json", isDirectory: false)
    }

    private static func cacheScope(for apiBase: URL) -> String {
        guard var components = URLComponents(url: apiBase, resolvingAgainstBaseURL: false) else {
            return apiBase.absoluteString
        }
        components.query = nil
        components.fragment = nil
        while components.path.count > 1 && components.path.hasSuffix("/") {
            components.path.removeLast()
        }
        return components.url?.absoluteString ?? apiBase.absoluteString
    }

    private static func loadCachedBootstrap(
        from cacheURL: URL?,
        apiBase: URL,
        expectedEventID: String
    ) -> PublicSandFestPayload? {
        guard let cacheURL,
              let data = try? Data(contentsOf: cacheURL),
              let cached = try? decoder.decode(PublicBootstrapCache.self, from: data),
              cached.schemaVersion == 1,
              cached.apiScope == cacheScope(for: apiBase),
              cached.eventID == expectedEventID else {
            return nil
        }
        do {
            try validate(cached.payload, expectedEventID: expectedEventID)
            return cached.payload
        } catch {
            return nil
        }
    }

    private static func persist(_ payload: PublicSandFestPayload, to cacheURL: URL?, apiBase: URL) {
        guard let cacheURL else { return }
        let cache = PublicBootstrapCache(
            schemaVersion: 1,
            apiScope: cacheScope(for: apiBase),
            eventID: payload.guide.id,
            savedAt: Date(),
            payload: payload
        )
        do {
            try FileManager.default.createDirectory(
                at: cacheURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try encoder.encode(cache).write(to: cacheURL, options: .atomic)
        } catch {
            // A cache write failure must not discard already-validated live data.
        }
    }

    private static func loadSeedPayload() throws -> SandFestPayload {
        guard let url = Bundle.main.url(forResource: "sandfest-seed", withExtension: "json") else {
            throw AppDataError.missingSeed
        }

        let data = try Data(contentsOf: url)
        return try decoder.decode(SandFestPayload.self, from: data)
    }
}

enum AppDataError: Error {
    case missingSeed
    case invalidResponse
    case httpStatus(Int)
    case invalidBootstrap
    case eventMismatch(expected: String, received: String)
    case invalidQuestion
    case invalidConciergeResponse
}

enum SyncState: Equatable {
    case cached
    case refreshing
    case live
    case offline

    var label: String {
        switch self {
        case .cached: "Cached"
        case .refreshing: "Refreshing"
        case .live: "Live"
        case .offline: "Offline"
        }
    }
}
