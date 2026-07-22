import SwiftUI

// MARK: - Passport store
//
// Tracks which sculptures the visitor has "stamped" on their Sculpture
// Passport. Mirrors FavoritesStore: small, per-user, UserDefaults-backed, no
// server roundtrip. Published entry IDs are persisted so a reordered roster
// cannot move a stamp to a different sculpture. On the beach a
// stamp is earned by scanning the QR at a sculpture; in the app you can also tap
// to collect (and the QR scanner reuses the existing Eventeny scanner).

@MainActor
final class PassportStore: ObservableObject {
    @Published private(set) var collected: Set<String>
    @Published private(set) var lastSyncNote: String?

    /// Stable device-scoped attendee id for POST /api/public/passport/stamp.
    let attendeeRef: String

    private let defaultsKey = "tsf.passport.collected"
    private let attendeeKey = "tsf.passport.attendeeRef"
    private let defaults = UserDefaults.standard

    init() {
        if let data = defaults.stringArray(forKey: defaultsKey) {
            collected = Set(data)
        } else if let legacy = defaults.array(forKey: defaultsKey) as? [Int] {
            collected = Set(legacy.map { "legacy:\($0)" })
        } else {
            collected = []
        }
        if let existing = defaults.string(forKey: attendeeKey), existing.count >= 4 {
            attendeeRef = existing
        } else {
            let fresh = "ios_\(UUID().uuidString)"
            defaults.set(fresh, forKey: attendeeKey)
            attendeeRef = fresh
        }
    }

    func isCollected(_ sculpture: Sculpture) -> Bool {
        collected.contains(sculpture.passportKey)
    }

    func toggle(_ sculpture: Sculpture) {
        let key = sculpture.passportKey
        if collected.contains(key) { collected.remove(key) } else { collected.insert(key) }
        persist()
        if collected.contains(key) {
            Task { await stampBackend(payload: sculpture.canonicalPassportCode, method: "tap") }
        }
    }

    func collect(_ sculpture: Sculpture) {
        guard collectLocally(sculpture) else { return }
        Task { await stampBackend(payload: sculpture.canonicalPassportCode, method: "tap") }
    }

    /// Stamp from a raw QR payload (tsf:cp:… / TSF-CP-… / bare id). Always
    /// updates local store when a published sculpture can be resolved.
    func collectFromScan(payload: String, localSculpture: Sculpture?) {
        if let localSculpture {
            _ = collectLocally(localSculpture)
        }
        Task { await stampBackend(payload: payload, method: "qr_scan") }
    }

    func reset() {
        collected.removeAll()
        persist()
    }

    private func persist() {
        defaults.set(Array(collected), forKey: defaultsKey)
    }

    private func collectLocally(_ sculpture: Sculpture) -> Bool {
        guard !collected.contains(sculpture.passportKey) else { return false }
        collected.insert(sculpture.passportKey)
        persist()
        return true
    }

    /// Best-effort sync to Node public stamp API. Offline-safe (local stamp already applied).
    func stampBackend(payload: String, method: String) async {
        let base = AppDataStore.apiBase
        var request = URLRequest(url: base.appending(path: "/api/public/passport/stamp"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "attendeeRef": attendeeRef,
            "payload": payload,
            "method": method
        ]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lastSyncNote = "No passport API response"
                return
            }
            if http.statusCode == 200 || http.statusCode == 201 {
                if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let progress = obj["progress"] as? [String: Any],
                   let complete = progress["complete"] as? Bool, complete {
                    lastSyncNote = "Passport complete — prize drawing entry saved"
                } else if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let already = obj["alreadyStamped"] as? Bool, already {
                    lastSyncNote = "Already stamped on server"
                } else {
                    lastSyncNote = "Stamp synced"
                }
            } else if http.statusCode == 400 {
                // Unrecognized code against the seeded hunt (e.g. iOS-only sculpture).
                lastSyncNote = "Local stamp kept (server code not in hunt)"
            } else {
                lastSyncNote = "Passport API \(http.statusCode) — offline local stamp kept"
            }
        } catch {
            lastSyncNote = "Offline — stamp saved on device"
        }
    }
}

// MARK: - Sculptors screen

struct SculptorsView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @EnvironmentObject private var passport: PassportStore

    @State private var filter: String = "All"
    @State private var selected: Sculpture? = nil
    @State private var scanning = false
    @State private var scanNote: String? = nil

    private var sculptures: [Sculpture] { dataStore.sculptures }

    private var categories: [String] {
        ["All"] + Array(Set(sculptures.map(\.category))).sorted()
    }

    private var filtered: [Sculpture] {
        (filter == "All" ? sculptures : sculptures.filter { $0.category == filter })
            .sorted { $0.sculptor < $1.sculptor }
    }

    private var collectedCount: Int {
        sculptures.filter { passport.isCollected($0) }.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label(dataStore.sculptorSource, systemImage: dataStore.sculptorSyncState == .live ? "checkmark.circle.fill" : "clock")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(dataStore.sculptorSyncState == .live ? Color.sandFestGulf : .secondary)
                    if sculptures.isEmpty {
                        ContentUnavailableView(
                            "Sculptor roster coming soon",
                            systemImage: "photo.artframe",
                            description: Text("The current event roster is awaiting staff publication.")
                        )
                        .frame(maxWidth: .infinity, minHeight: 360)
                    } else {
                        passportHeader
                        corridorMap
                        filterChips
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(filtered) { sculpture in
                                Button { selected = sculpture } label: {
                                    sculptorRow(sculpture)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Sculptors")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { scanning = true } label: {
                        Label("Scan", systemImage: "qrcode.viewfinder")
                    }
                    .disabled(sculptures.isEmpty)
                }
            }
        }
        .tint(.sandFestGulf)
        .sheet(item: $selected) { sculpture in
            SculptorDetailSheet(sculpture: sculpture)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $scanning) { scannerSheet }
    }

    // MARK: Passport header

    private var passportHeader: some View {
        let total = sculptures.count
        let complete = collectedCount == total && total > 0
        return Panel {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sculpture Passport")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.sandFestSun)
                        Text("Collect every sculpture")
                            .font(.headline)
                        Text("Scan the QR at each sculpture to stamp your passport. Finish to enter the prize drawing.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(collectedCount)/\(total)")
                        .font(.title3.weight(.heavy))
                        .foregroundStyle(Color.sandFestDeep)
                }
                ProgressView(value: Double(collectedCount), total: Double(max(total, 1)))
                    .tint(complete ? Color.sandFestSun : Color.sandFestGulf)
                if complete {
                    Text("🎉 Passport complete — you'd now be entered into the prize drawing.")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.sandFestCoral)
                }
            }
        }
    }

    // MARK: Compact corridor map

    private var corridorMap: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    colors: [Color.sandFestGulf, Color.sandFestSand],
                    startPoint: .top, endPoint: .bottom
                )
                ForEach(sculptures) { sculpture in
                    Button { selected = sculpture } label: {
                        Circle()
                            .fill(categoryColor(sculpture.category))
                            .frame(width: 16, height: 16)
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .overlay(alignment: .center) {
                                if passport.isCollected(sculpture) {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 8, weight: .black))
                                        .foregroundStyle(.white)
                                }
                            }
                            .shadow(radius: 2)
                    }
                    .position(
                        x: sculpture.x * geo.size.width,
                        y: sculpture.y * geo.size.height
                    )
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .frame(height: 170)
        .overlay(alignment: .bottomLeading) {
            Text("Gulf shoreline · tap a pin for the sculptor")
                .font(.caption2)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(Color.sandFestFoam.opacity(0.85), in: Capsule())
                .padding(8)
        }
    }

    // MARK: Filters

    private var filterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(categories, id: \.self) { category in
                    let active = filter == category
                    Button { filter = category } label: {
                        Text(category)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 7)
                            .background(active ? Color.sandFestDeep : Color.white, in: Capsule())
                            .foregroundStyle(active ? Color.sandFestSand : Color.secondary)
                            .overlay(Capsule().stroke(Color.sandFestDeep.opacity(active ? 0 : 0.15)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Roster row

    private func sculptorRow(_ sculpture: Sculpture) -> some View {
        Panel {
            HStack(spacing: 12) {
                sculptureThumb(sculpture)
                VStack(alignment: .leading, spacing: 3) {
                    Text(sculpture.sculptor)
                        .font(.headline)
                    Text("\(sculpture.category) · \(sculpture.country)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(categoryColor(sculpture.category))
                    Text("“\(sculpture.title)”")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if passport.isCollected(sculpture) {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(Color.sandFestSun)
                }
            }
        }
    }

    private func sculptureThumb(_ sculpture: Sculpture) -> some View {
        AsyncImage(url: URL(string: sculpture.photoURL)) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            default:
                Color.sandFestSand
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Scanner

    private var scannerSheet: some View {
        ZStack(alignment: .bottom) {
            QRScannerView { payload in
                handleScan(payload)
            }
            .ignoresSafeArea()
            VStack(spacing: 8) {
                if let note = scanNote {
                    Text(note)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.black.opacity(0.6), in: Capsule())
                }
                Button("Done") { scanning = false }
                    .buttonStyle(.borderedProminent)
                    .tint(.sandFestGulf)
                    .padding(.bottom, 24)
            }
        }
    }

    /// QR may be tsf:cp:…, TSF-CP-0003, TSF-SCULPT-3, or a bare id. Prefer a
    /// local sculpture match for UI; always attempt backend stamp via PassportStore.
    private func handleScan(_ payload: String) {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = trimmed.filter(\.isNumber)
        let localId = Int(digits)
        let entryId = trimmed.lowercased().hasPrefix("tsf:entry:")
            ? String(trimmed.dropFirst("tsf:entry:".count))
            : nil
        let match = sculptures.first(where: { sculpture in
            sculpture.entryId == entryId
                || sculpture.canonicalPassportCode.caseInsensitiveCompare(trimmed) == .orderedSame
                || (entryId == nil && localId == sculpture.id)
        })

        if let match {
            passport.collectFromScan(payload: trimmed, localSculpture: match)
            scanNote = "Stamped: \(match.sculptor)"
        } else if trimmed.lowercased().hasPrefix("tsf:") || trimmed.uppercased().hasPrefix("TSF-CP-") {
            passport.collectFromScan(payload: trimmed, localSculpture: nil)
            scanNote = "Stamp sent to server"
        } else {
            scanNote = "Unrecognized code"
            return
        }
        if let note = passport.lastSyncNote {
            scanNote = "\(scanNote ?? "") · \(note)"
        }
    }
}

// MARK: - Detail sheet

struct SculptorDetailSheet: View {
    let sculpture: Sculpture
    @EnvironmentObject private var passport: PassportStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                AsyncImage(url: URL(string: sculpture.photoURL)) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Color.sandFestSand
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 18))

                HStack {
                    Text(sculpture.category)
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(categoryColor(sculpture.category), in: Capsule())
                        .foregroundStyle(.white)
                    if sculpture.state == "sculpting" || sculpture.state == "carving" {
                        Text("Sculpting")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.sandFestCoral)
                    }
                    Spacer()
                    if sculpture.crowdStatusVerified != false {
                        Text(sculpture.crowd.label)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Text(sculpture.sculptor)
                    .font(.title2.weight(.bold))
                Text("“\(sculpture.title)” · \(sculpture.country)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(sculpture.bio)
                    .font(.body)

                if !sculpture.audioMinutes.isEmpty || !sculpture.timelapseHours.isEmpty {
                    HStack(spacing: 14) {
                        if !sculpture.audioMinutes.isEmpty {
                            Label(sculpture.audioMinutes, systemImage: "headphones")
                        }
                        if !sculpture.timelapseHours.isEmpty {
                            Label(sculpture.timelapseHours, systemImage: "timelapse")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Button {
                    passport.toggle(sculpture)
                } label: {
                    Label(
                        passport.isCollected(sculpture) ? "Stamped — tap to remove" : "Collect passport stamp",
                        systemImage: passport.isCollected(sculpture) ? "checkmark.seal.fill" : "seal"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(passport.isCollected(sculpture) ? Color.sandFestSun : Color.sandFestGulf)
                .padding(.top, 4)
            }
            .padding()
        }
        .background(Color.sandFestFoam.ignoresSafeArea())
    }
}

// MARK: - Shared helpers

func categoryColor(_ category: String) -> Color {
    switch category {
    case "Master Solo": return .sandFestGulf
    case "Master Duo": return .sandFestCoral
    case "Semi-Pro": return .sandFestSun
    default: return .sandFestDeep
    }
}
