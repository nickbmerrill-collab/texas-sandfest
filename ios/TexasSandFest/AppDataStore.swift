import Foundation

@MainActor
final class AppDataStore: ObservableObject {
    @Published private(set) var payload: SandFestPayload
    @Published private(set) var alert: EmergencyAlert
    @Published private(set) var source: String
    @Published private(set) var syncState: SyncState = .cached

    init() {
        let fallback = SandFestPayload.sample
        do {
            let loaded = try Self.loadSeedPayload()
            // Until the bootstrap → ios:seed pipeline is regenerated with the
            // ACL-shaped schedule and the user's wristbands, prefer the in-code
            // SampleData for those slots. Everything else (guide/zones/sponsors)
            // still rides the seed file.
            let needsRichSchedule = loaded.schedule.count < 10
            let mergedSchedule = needsRichSchedule ? SampleData.schedule : loaded.schedule
            payload = SandFestPayload(
                guide: loaded.guide,
                alert: loaded.alert,
                schedule: mergedSchedule,
                zones: loaded.zones,
                ticketOptions: loaded.ticketOptions,
                sponsors: loaded.sponsors,
                vendors: loaded.vendors,
                coverage: loaded.coverage,
                financeSignals: loaded.financeSignals,
                myTickets: loaded.myTickets ?? SampleData.myTickets
            )
            alert = loaded.alert
            source = needsRichSchedule ? "Bundled seed (sample schedule overlay)" : "Bundled seed"
        } catch {
            payload = fallback
            alert = fallback.alert
            source = "Fallback sample"
        }
    }

    /// Resolved API base, in priority order:
    /// 1. CommandLine `-apiBase URL` (handy for demos / local routing)
    /// 2. `SANDFEST_API_BASE` env var (CI / TestFlight builds)
    /// 3. Info.plist `SandFestAPIBase` (per-config plist override)
    /// 4. https://api.heyelab.com/sandfest (production default)
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
        return URL(string: "https://api.heyelab.com/sandfest")!
        #endif
    }

    func refreshPublicAlert(apiBase: URL? = nil) async {
        let base = apiBase ?? Self.apiBase
        syncState = .refreshing
        do {
            let url = base.appending(path: "/api/public/alert")
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                syncState = .offline
                return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            alert = try decoder.decode(EmergencyAlert.self, from: data)
            syncState = .live
        } catch {
            syncState = .offline
        }
    }

    private static func loadSeedPayload() throws -> SandFestPayload {
        guard let url = Bundle.main.url(forResource: "sandfest-seed", withExtension: "json") else {
            throw AppDataError.missingSeed
        }

        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(SandFestPayload.self, from: data)
    }
}

enum AppDataError: Error {
    case missingSeed
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
