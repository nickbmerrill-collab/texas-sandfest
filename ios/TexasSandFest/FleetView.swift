import SwiftUI

// MARK: - Fleet models (mirror data/schemas/platform-objects.json + lib/fleet.mjs)

struct FleetAsset: Identifiable, Codable, Hashable {
    let id: String
    var eventId: String?
    var type: String
    var label: String
    var identifier: String?
    var owner: String?
    var rentalVendor: String?
    var rentalCostCents: Int?
    var capacity: Int?
    var powerType: String?
    var gpsTrackerId: String?
    var condition: String
    var status: String
    var homeZoneId: String?
    var qrPayload: String?
    var activeCheckout: FleetCheckout?
    var lastLocation: FleetLocation?

    var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var typeLabel: String {
        type.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var isAvailable: Bool { status == "available" }
    var isCheckedOut: Bool { status == "checked_out" || activeCheckout != nil }
    var isMaintenance: Bool { status == "maintenance" }
}

struct FleetCheckout: Identifiable, Codable, Hashable {
    let id: String
    var assetId: String
    var eventId: String?
    var checkedOutTo: String
    var team: String
    var checkOutAt: String?
    var checkInAt: String?
    var startCondition: String?
    var endCondition: String?
    var startChargePct: Int?
    var endChargePct: Int?
    var damageReport: String?
    var signatureBy: String?
    var method: String?
}

struct FleetLocation: Identifiable, Codable, Hashable {
    let id: String
    var assetId: String
    var at: String?
    var lat: Double?
    var lng: Double?
    var beachMarker: String?
    var source: String?

    var display: String {
        if let beachMarker, !beachMarker.isEmpty { return beachMarker }
        if let lat, let lng { return String(format: "%.4f, %.4f", lat, lng) }
        return "—"
    }
}

struct FleetSummary: Codable {
    var totals: FleetTotals
    var byStatus: [String: Int]?
    var byType: [String: Int]?
    var teams: [String: Int]?
}

struct FleetTotals: Codable {
    var assets: Int
    var available: Int
    var checkedOut: Int
    var maintenance: Int
    var openCheckouts: Int
    var withTracker: Int
    var withLiveLocation: Int
    var rentalCostCents: Int
    var damageReports: Int
}

struct FleetDashboardPayload: Codable {
    var lastUpdated: String?
    var eventId: String?
    var summary: FleetSummary
    var assets: [FleetAsset]
    var openCheckouts: [FleetCheckout]
}

// MARK: - Sample seed (offline / no API)

enum FleetSampleData {
    static let assets: [FleetAsset] = [
        FleetAsset(
            id: "cart-01", type: "golf_cart", label: "Cart 01", identifier: "IC-GC-101",
            owner: "rental", rentalVendor: "Island Carts", rentalCostCents: 45000,
            capacity: 4, powerType: "electric", gpsTrackerId: "tracker_01",
            condition: "good", status: "checked_out", homeZoneId: "command",
            qrPayload: "tsf:asset:cart-01",
            activeCheckout: FleetCheckout(
                id: "co_seed_001", assetId: "cart-01", checkedOutTo: "Maya R.",
                team: "site-ops", checkOutAt: "2026-04-18T07:15:00-05:00",
                startCondition: "good", startChargePct: 100, method: "ios_scan"
            ),
            lastLocation: FleetLocation(
                id: "loc_1", assetId: "cart-01", beachMarker: "14", source: "lorawan"
            )
        ),
        FleetAsset(
            id: "cart-02", type: "golf_cart", label: "Cart 02", identifier: "IC-GC-102",
            owner: "rental", rentalVendor: "Island Carts", rentalCostCents: 45000,
            capacity: 4, powerType: "electric", gpsTrackerId: "tracker_02",
            condition: "good", status: "available", homeZoneId: "command",
            qrPayload: "tsf:asset:cart-02", activeCheckout: nil,
            lastLocation: FleetLocation(
                id: "loc_2", assetId: "cart-02", beachMarker: "command", source: "manual"
            )
        ),
        FleetAsset(
            id: "cart-04", type: "golf_cart", label: "Cart 04 · ADA", identifier: "IC-GC-104",
            owner: "rental", rentalVendor: "Island Carts", rentalCostCents: 52000,
            capacity: 4, powerType: "electric", gpsTrackerId: "tracker_04",
            condition: "excellent", status: "checked_out", homeZoneId: "ada-staging",
            qrPayload: "tsf:asset:cart-04",
            activeCheckout: FleetCheckout(
                id: "co_seed_002", assetId: "cart-04", checkedOutTo: "Jordan L.",
                team: "ada", checkOutAt: "2026-04-18T07:40:00-05:00",
                startCondition: "excellent", startChargePct: 95, method: "ios_scan"
            ),
            lastLocation: FleetLocation(
                id: "loc_3", assetId: "cart-04", beachMarker: "ADA-1", source: "lorawan"
            )
        ),
        FleetAsset(
            id: "utv-01", type: "utv", label: "Gator 01", identifier: "JD-GATOR-01",
            owner: "rental", rentalVendor: "Coastal Equipment Co", rentalCostCents: 78000,
            capacity: 2, powerType: "gas", gpsTrackerId: "tracker_utv_01",
            condition: "good", status: "checked_out", homeZoneId: "site-ops",
            qrPayload: "tsf:asset:utv-01",
            activeCheckout: FleetCheckout(
                id: "co_seed_003", assetId: "utv-01", checkedOutTo: "Chris P.",
                team: "site-ops", checkOutAt: "2026-04-18T06:50:00-05:00",
                startCondition: "good", method: "kiosk"
            ),
            lastLocation: FleetLocation(
                id: "loc_4", assetId: "utv-01", beachMarker: "load-in", source: "lorawan"
            )
        ),
        FleetAsset(
            id: "gen-01", type: "generator", label: "Generator · Stage", identifier: "GEN-20KW-01",
            owner: "rental", rentalVendor: "Port A Power", rentalCostCents: 125000,
            capacity: nil, powerType: "diesel", gpsTrackerId: nil,
            condition: "good", status: "checked_out", homeZoneId: "main-stage",
            qrPayload: "tsf:asset:gen-01",
            activeCheckout: FleetCheckout(
                id: "co_seed_004", assetId: "gen-01", checkedOutTo: "Stage crew",
                team: "production", checkOutAt: "2026-04-17T14:00:00-05:00",
                startCondition: "good", method: "manual"
            ),
            lastLocation: nil
        ),
        FleetAsset(
            id: "cart-06", type: "golf_cart", label: "Cart 06", identifier: "IC-GC-106",
            owner: "rental", rentalVendor: "Island Carts", rentalCostCents: 45000,
            capacity: 4, powerType: "electric", gpsTrackerId: "tracker_06",
            condition: "damaged", status: "maintenance", homeZoneId: "command",
            qrPayload: "tsf:asset:cart-06", activeCheckout: nil, lastLocation: nil
        )
    ]
}

// MARK: - QR payload helper

enum FleetQR {
    /// Accepts `tsf:asset:cart-07` or a bare asset id.
    static func parse(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        if value.lowercased().hasPrefix("tsf:asset:") {
            let id = String(value.dropFirst("tsf:asset:".count))
            return id.isEmpty ? nil : id
        }
        // Bare id: letters, digits, dash, underscore, dot
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        if value.unicodeScalars.allSatisfy({ allowed.contains($0) }), value.count <= 64 {
            return value
        }
        return nil
    }
}

// MARK: - Local offline store (mirrors seed until API is reachable)

@MainActor
final class FleetStore: ObservableObject {
    @Published private(set) var assets: [FleetAsset]
    @Published private(set) var source: String
    @Published var lastError: String?

    init(seed: [FleetAsset] = FleetSampleData.assets) {
        assets = seed
        source = "Sample seed"
    }

    var availableCount: Int { assets.filter(\.isAvailable).count }
    var checkedOutCount: Int { assets.filter(\.isCheckedOut).count }
    var maintenanceCount: Int { assets.filter(\.isMaintenance).count }

    func asset(id: String) -> FleetAsset? {
        assets.first { $0.id == id }
    }

    func applyLocalCheckout(
        assetId: String,
        checkedOutTo: String,
        team: String,
        startChargePct: Int?,
        method: String
    ) -> String? {
        guard let idx = assets.firstIndex(where: { $0.id == assetId }) else {
            return "Asset not found: \(assetId)"
        }
        var asset = assets[idx]
        if asset.isMaintenance { return "Asset is in maintenance." }
        if asset.isCheckedOut { return "Asset is already checked out." }
        let trimmed = checkedOutTo.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Name / callsign is required." }

        let checkout = FleetCheckout(
            id: "co_local_\(UUID().uuidString.prefix(8))",
            assetId: assetId,
            checkedOutTo: trimmed,
            team: team.trimmingCharacters(in: .whitespacesAndNewlines),
            checkOutAt: ISO8601DateFormatter().string(from: Date()),
            startCondition: asset.condition,
            startChargePct: startChargePct,
            method: method
        )
        asset.status = "checked_out"
        asset.activeCheckout = checkout
        assets[idx] = asset
        source = "Local (offline)"
        return nil
    }

    func applyLocalCheckin(
        assetId: String,
        endChargePct: Int?,
        damageReport: String?,
        method: String
    ) -> String? {
        guard let idx = assets.firstIndex(where: { $0.id == assetId }) else {
            return "Asset not found: \(assetId)"
        }
        var asset = assets[idx]
        guard asset.activeCheckout != nil || asset.isCheckedOut else {
            return "No open checkout for \(assetId)."
        }
        let damaged = !(damageReport ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        asset.status = damaged ? "maintenance" : "available"
        if damaged { asset.condition = "damaged" }
        asset.activeCheckout = nil
        assets[idx] = asset
        source = "Local (offline)"
        return nil
    }

    func replace(with remote: [FleetAsset], source label: String) {
        assets = remote
        source = label
        lastError = nil
    }

    func refreshFromAPI(token: String? = nil) async {
        let base = AppDataStore.apiBase
        var request = URLRequest(url: base.appending(path: "/api/admin/fleet"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else if let env = ProcessInfo.processInfo.environment["SANDFEST_ADMIN_API_TOKEN"] {
            request.setValue("Bearer \(env)", forHTTPHeaderField: "Authorization")
        }
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastError = "No response"
                return
            }
            if http.statusCode == 401 || http.statusCode == 403 {
                // Expected without a token — keep sample seed.
                lastError = nil
                source = "Sample seed (API auth required)"
                return
            }
            guard http.statusCode == 200 else {
                lastError = "Fleet API \(http.statusCode)"
                return
            }
            let payload = try JSONDecoder().decode(FleetDashboardPayload.self, from: data)
            replace(with: payload.assets, source: "Live API")
        } catch {
            // Offline-first: keep seed, surface a soft note.
            lastError = nil
            source = "Sample seed (offline)"
        }
    }

    func postCheckout(
        assetId: String,
        checkedOutTo: String,
        team: String,
        startChargePct: Int?,
        token: String?
    ) async -> String? {
        var body: [String: Any] = [
            "assetId": assetId,
            "checkedOutTo": checkedOutTo,
            "team": team,
            "method": "ios_scan"
        ]
        if let startChargePct { body["startChargePct"] = startChargePct }
        if let err = await postMutation(path: "/api/admin/fleet/checkout", body: body, token: token) {
            // Fall back to local so ops still works on the beach.
            if let local = applyLocalCheckout(
                assetId: assetId,
                checkedOutTo: checkedOutTo,
                team: team,
                startChargePct: startChargePct,
                method: "ios_scan"
            ) {
                return "\(err) · local: \(local)"
            }
            return "\(err) — recorded offline."
        }
        await refreshFromAPI(token: token)
        return nil
    }

    func postCheckin(
        assetId: String,
        endChargePct: Int?,
        damageReport: String?,
        token: String?
    ) async -> String? {
        let damaged = !(damageReport ?? "").isEmpty
        var body: [String: Any] = [
            "assetId": assetId,
            "endCondition": damaged ? "damaged" : "good",
            "method": "ios_scan"
        ]
        if let endChargePct { body["endChargePct"] = endChargePct }
        if let damageReport, !damageReport.isEmpty { body["damageReport"] = damageReport }
        if let err = await postMutation(path: "/api/admin/fleet/checkin", body: body, token: token) {
            if let local = applyLocalCheckin(
                assetId: assetId,
                endChargePct: endChargePct,
                damageReport: damageReport,
                method: "ios_scan"
            ) {
                return "\(err) · local: \(local)"
            }
            return "\(err) — recorded offline."
        }
        await refreshFromAPI(token: token)
        return nil
    }

    private func postMutation(path: String, body: [String: Any], token: String?) async -> String? {
        let base = AppDataStore.apiBase
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let auth = token
            ?? ProcessInfo.processInfo.environment["SANDFEST_ADMIN_API_TOKEN"]
        if let auth, !auth.isEmpty {
            request.setValue("Bearer \(auth)", forHTTPHeaderField: "Authorization")
        }
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return "No response" }
            if http.statusCode == 200 { return nil }
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = obj["error"] as? String {
                return error
            }
            return "HTTP \(http.statusCode)"
        } catch {
            return error.localizedDescription
        }
    }
}

// MARK: - Fleet ops screen

struct FleetView: View {
    @StateObject private var store = FleetStore()
    @State private var filter: FleetFilter = .all
    @State private var scanning = false
    @State private var selected: FleetAsset?
    @State private var sheetMode: FleetSheetMode = .detail
    @State private var statusNote: String?

    private var filtered: [FleetAsset] {
        let base: [FleetAsset]
        switch filter {
        case .all: base = store.assets
        case .available: base = store.assets.filter(\.isAvailable)
        case .out: base = store.assets.filter(\.isCheckedOut)
        case .maintenance: base = store.assets.filter(\.isMaintenance)
        }
        return base.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    kpiHeader
                    if let statusNote {
                        Text(statusNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)
                    }
                    filterChips
                    LazyVStack(spacing: 10) {
                        ForEach(filtered) { asset in
                            Button {
                                selected = asset
                                sheetMode = .detail
                            } label: {
                                fleetRow(asset)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Fleet")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Text(store.source)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await store.refreshFromAPI() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    Button { scanning = true } label: {
                        Label("Scan", systemImage: "qrcode.viewfinder")
                    }
                }
            }
            .sheet(isPresented: $scanning) {
                NavigationStack {
                    QRScannerView { payload in
                        scanning = false
                        handleScan(payload)
                    }
                    .navigationTitle("Scan asset QR")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { scanning = false }
                        }
                    }
                }
            }
            .sheet(item: $selected) { asset in
                FleetAssetSheet(
                    asset: asset,
                    mode: sheetMode,
                    onCheckout: { name, team, charge in
                        Task {
                            let note = await store.postCheckout(
                                assetId: asset.id,
                                checkedOutTo: name,
                                team: team,
                                startChargePct: charge,
                                token: nil
                            )
                            statusNote = note ?? "Checked out \(asset.label) to \(name)."
                            selected = nil
                        }
                    },
                    onCheckin: { charge, damage in
                        Task {
                            let note = await store.postCheckin(
                                assetId: asset.id,
                                endChargePct: charge,
                                damageReport: damage,
                                token: nil
                            )
                            statusNote = note ?? "Checked in \(asset.label)."
                            selected = nil
                        }
                    }
                )
            }
            .task {
                await store.refreshFromAPI()
            }
        }
    }

    private var kpiHeader: some View {
        HStack(spacing: 10) {
            kpiTile("Available", "\(store.availableCount)", Color.sandFestGulf)
            kpiTile("Out", "\(store.checkedOutCount)", Color.sandFestCoral)
            kpiTile("Shop", "\(store.maintenanceCount)", Color.orange)
        }
    }

    private func kpiTile(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.white.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(FleetFilter.allCases) { item in
                    Button {
                        filter = item
                    } label: {
                        Text(item.title)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(filter == item ? Color.sandFestGulf : Color.white.opacity(0.9))
                            .foregroundStyle(filter == item ? Color.white : Color.primary)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func fleetRow(_ asset: FleetAsset) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon(for: asset.type))
                .font(.title3)
                .foregroundStyle(statusColor(asset))
                .frame(width: 36, height: 36)
                .background(statusColor(asset).opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(asset.label)
                        .font(.headline)
                    Spacer()
                    Text(asset.statusLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(statusColor(asset))
                }
                Text("\(asset.typeLabel) · \(asset.id)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let co = asset.activeCheckout {
                    Text("\(co.checkedOutTo) · \(co.team.isEmpty ? "no team" : co.team)")
                        .font(.subheadline)
                }
                if let loc = asset.lastLocation {
                    Text("📍 \(loc.display)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(12)
        .background(Color.white.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func handleScan(_ payload: String) {
        guard let assetId = FleetQR.parse(payload) else {
            statusNote = "Not an asset QR: \(payload)"
            return
        }
        guard let asset = store.asset(id: assetId) else {
            statusNote = "Unknown asset: \(assetId)"
            return
        }
        selected = asset
        sheetMode = asset.isCheckedOut ? .checkin : .checkout
        statusNote = "Scanned \(asset.label)"
    }

    private func icon(for type: String) -> String {
        switch type {
        case "golf_cart": return "car.side"
        case "utv", "atv": return "truck.box"
        case "generator": return "bolt.fill"
        case "truck": return "box.truck"
        default: return "wrench.and.screwdriver"
        }
    }

    private func statusColor(_ asset: FleetAsset) -> Color {
        if asset.isMaintenance { return .orange }
        if asset.isCheckedOut { return .sandFestCoral }
        return .sandFestGulf
    }
}

enum FleetFilter: String, CaseIterable, Identifiable {
    case all, available, out, maintenance
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: "All"
        case .available: "Available"
        case .out: "Out"
        case .maintenance: "Shop"
        }
    }
}

enum FleetSheetMode {
    case detail, checkout, checkin
}

struct FleetAssetSheet: View {
    let asset: FleetAsset
    var mode: FleetSheetMode
    var onCheckout: (String, String, Int?) -> Void
    var onCheckin: (Int?, String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var team = "site-ops"
    @State private var startCharge = "100"
    @State private var endCharge = ""
    @State private var damage = ""
    @State private var localMode: FleetSheetMode

    init(
        asset: FleetAsset,
        mode: FleetSheetMode,
        onCheckout: @escaping (String, String, Int?) -> Void,
        onCheckin: @escaping (Int?, String?) -> Void
    ) {
        self.asset = asset
        self.mode = mode
        self.onCheckout = onCheckout
        self.onCheckin = onCheckin
        _localMode = State(initialValue: mode)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Asset") {
                    LabeledContent("Label", value: asset.label)
                    LabeledContent("ID", value: asset.id)
                    LabeledContent("Type", value: asset.typeLabel)
                    LabeledContent("Status", value: asset.statusLabel)
                    LabeledContent("Condition", value: asset.condition.capitalized)
                    if let qr = asset.qrPayload {
                        LabeledContent("QR", value: qr)
                    }
                    if let loc = asset.lastLocation {
                        LabeledContent("Location", value: loc.display)
                    }
                }

                if let co = asset.activeCheckout {
                    Section("Active checkout") {
                        LabeledContent("To", value: co.checkedOutTo)
                        LabeledContent("Team", value: co.team.isEmpty ? "—" : co.team)
                        if let pct = co.startChargePct {
                            LabeledContent("Start charge", value: "\(pct)%")
                        }
                        if let at = co.checkOutAt {
                            LabeledContent("Since", value: at)
                        }
                    }
                }

                if localMode == .checkout || (!asset.isCheckedOut && localMode == .detail) {
                    Section("Check out") {
                        TextField("Name / callsign", text: $name)
                        TextField("Team", text: $team)
                        TextField("Start charge %", text: $startCharge)
                            .keyboardType(.numberPad)
                        Button("Check out") {
                            onCheckout(name, team, Int(startCharge))
                        }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || asset.isCheckedOut || asset.isMaintenance)
                    }
                }

                if localMode == .checkin || (asset.isCheckedOut && localMode == .detail) {
                    Section("Check in") {
                        TextField("End charge %", text: $endCharge)
                            .keyboardType(.numberPad)
                        TextField("Damage notes (optional)", text: $damage, axis: .vertical)
                        Button("Check in") {
                            onCheckin(
                                Int(endCharge),
                                damage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : damage
                            )
                        }
                        .disabled(!asset.isCheckedOut)
                    }
                }
            }
            .navigationTitle(asset.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    if asset.isCheckedOut {
                        Button("Check in") { localMode = .checkin }
                    } else if asset.isAvailable {
                        Button("Check out") { localMode = .checkout }
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

#Preview {
    FleetView()
}
