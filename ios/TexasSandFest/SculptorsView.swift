import SwiftUI

// MARK: - Passport store
//
// Tracks which sculptures the visitor has "stamped" on their Sculpture
// Passport. Mirrors FavoritesStore: small, per-user, UserDefaults-backed, no
// server roundtrip. Sculpture.id is an Int, so we persist [Int]. On the beach a
// stamp is earned by scanning the QR at a sculpture; in the app you can also tap
// to collect (and the QR scanner reuses the existing Eventeny scanner).

@MainActor
final class PassportStore: ObservableObject {
    @Published private(set) var collected: Set<Int>

    private let defaultsKey = "tsf.passport.collected"
    private let defaults = UserDefaults.standard

    init() {
        if let data = defaults.array(forKey: defaultsKey) as? [Int] {
            collected = Set(data)
        } else {
            collected = []
        }
    }

    func isCollected(_ id: Int) -> Bool { collected.contains(id) }

    func toggle(_ id: Int) {
        if collected.contains(id) { collected.remove(id) } else { collected.insert(id) }
        persist()
    }

    func collect(_ id: Int) {
        guard !collected.contains(id) else { return }
        collected.insert(id)
        persist()
    }

    func reset() {
        collected.removeAll()
        persist()
    }

    private func persist() {
        defaults.set(Array(collected), forKey: defaultsKey)
    }
}

// MARK: - Sculptors screen

struct SculptorsView: View {
    @EnvironmentObject private var passport: PassportStore

    @State private var filter: String = "All"
    @State private var selected: Sculpture? = nil
    @State private var scanning = false
    @State private var scanNote: String? = nil

    private var sculptures: [Sculpture] { SampleData.liveBeach.sculptures }

    private var categories: [String] {
        ["All"] + Array(Set(sculptures.map(\.category))).sorted()
    }

    private var filtered: [Sculpture] {
        (filter == "All" ? sculptures : sculptures.filter { $0.category == filter })
            .sorted { $0.sculptor < $1.sculptor }
    }

    private var collectedCount: Int {
        sculptures.filter { passport.isCollected($0.id) }.count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
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
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Sculptors")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { scanning = true } label: {
                        Label("Scan", systemImage: "qrcode.viewfinder")
                    }
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
                                if passport.isCollected(sculpture.id) {
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
                if passport.isCollected(sculpture.id) {
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

    /// A sculpture QR encodes its id (e.g. "TSF-SCULPT-3" or a bare "3"). Pull
    /// the first integer out of the payload and stamp that sculpture if it exists.
    private func handleScan(_ payload: String) {
        let digits = payload.filter(\.isNumber)
        guard let id = Int(digits), let match = sculptures.first(where: { $0.id == id }) else {
            scanNote = "Unrecognized code"
            return
        }
        passport.collect(match.id)
        scanNote = "Stamped: \(match.sculptor)"
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
                    if sculpture.state == "carving" {
                        Text("● Sculpting live")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.sandFestCoral)
                    }
                    Spacer()
                    Text(sculpture.crowd.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(sculpture.sculptor)
                    .font(.title2.weight(.bold))
                Text("“\(sculpture.title)” · \(sculpture.country)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(sculpture.bio)
                    .font(.body)

                HStack(spacing: 14) {
                    Label(sculpture.audioMinutes, systemImage: "headphones")
                    Label(sculpture.timelapseHours, systemImage: "timelapse")
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                Button {
                    passport.toggle(sculpture.id)
                } label: {
                    Label(
                        passport.isCollected(sculpture.id) ? "Stamped — tap to remove" : "Collect passport stamp",
                        systemImage: passport.isCollected(sculpture.id) ? "checkmark.seal.fill" : "seal"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(passport.isCollected(sculpture.id) ? Color.sandFestSun : Color.sandFestGulf)
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
