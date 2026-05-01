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
            let loadedPayload = try Self.loadSeedPayload()
            payload = loadedPayload
            alert = loadedPayload.alert
            source = "Bundled seed"
        } catch {
            payload = fallback
            alert = fallback.alert
            source = "Fallback sample"
        }
    }

    func refreshPublicAlert(apiBase: URL = URL(string: "http://127.0.0.1:8788")!) async {
        syncState = .refreshing
        do {
            let url = apiBase.appending(path: "/api/public/alert")
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
