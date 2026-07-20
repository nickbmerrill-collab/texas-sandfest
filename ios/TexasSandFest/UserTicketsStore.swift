import Foundation

/// Persists tickets the user has imported (e.g., scanned an Eventeny QR) to
/// UserDefaults so they survive app launches and work offline at the gate.
@MainActor
final class UserTicketsStore: ObservableObject {
    @Published private(set) var imported: [Ticket]

    private let defaultsKey: String
    private let defaults: UserDefaults
    private let now: () -> Date

    init(
        defaults: UserDefaults = .standard,
        defaultsKey: String = "tsf.userTickets.imported",
        now: @escaping () -> Date = Date.init
    ) {
        self.defaults = defaults
        self.defaultsKey = defaultsKey
        self.now = now
        if let data = defaults.data(forKey: defaultsKey),
           let decoded = try? JSONDecoder().decode([Ticket].self, from: data) {
            imported = decoded
        } else {
            imported = []
        }
    }

    /// Add a ticket from a scanned QR payload. The payload is treated as the
    /// canonical ticket id (gate scanners read the same string).
    func importFromQR(_ payload: String, eventGuide: EventGuide, holderHint: String? = nil) -> Ticket {
        // Heuristic mapping until Eventeny gives us a real schema.
        let band: TicketBand = {
            let lower = payload.lowercased()
            if lower.contains("vip") { return .threeDayVIP }
            if lower.contains("sponsor") { return .sponsor }
            if lower.contains("staff") { return .staff }
            if lower.contains("raffle") { return .raffle }
            if lower.contains("single") || lower.contains("day1") { return .singleDay }
            return .threeDayGA
        }()

        let ticket = Ticket(
            id: payload,
            band: band,
            holder: holderHint ?? "Imported wristband",
            dayPass: "All 3 days · \(LiveTimeline.shortDateRange(for: eventGuide))",
            seat: nil,
            purchaseSource: payload.lowercased().contains("eventeny") ? "Eventeny (scanned)" : "Scanned QR",
            issuedAt: now(),
            entryStatus: .unused
        )

        if !imported.contains(where: { $0.id == ticket.id }) {
            imported.insert(ticket, at: 0)
            persist()
        }
        return ticket
    }

    func remove(_ id: String) {
        imported.removeAll { $0.id == id }
        persist()
    }

    func clearAll() {
        imported.removeAll()
        persist()
    }

    private func persist() {
        if let encoded = try? JSONEncoder().encode(imported) {
            defaults.set(encoded, forKey: defaultsKey)
        }
    }
}
