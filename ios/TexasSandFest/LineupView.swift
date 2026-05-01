import SwiftUI

/// Lineup A–Z view — every artist on the bill, with a sticky alphabetical
/// index running down the right edge (ACL-style). When the user provides the
/// real lineup, photos can drop in via Artist.photoURL.

struct LineupView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @State private var selected: Artist? = nil

    /// Build artist cards from the schedule. Multiple set times merge into one.
    private var artists: [Artist] {
        var bag: [String: Artist] = [:]
        for item in dataStore.payload.schedule {
            guard let name = item.artist else { continue }
            if var existing = bag[name] {
                existing.appearances.append(.init(day: item.day, time: item.time, stage: item.stage ?? item.zone))
                bag[name] = existing
            } else {
                bag[name] = Artist(
                    name: name,
                    primaryStage: item.stage ?? item.zone,
                    category: item.category,
                    appearances: [.init(day: item.day, time: item.time, stage: item.stage ?? item.zone)]
                )
            }
        }
        return bag.values.sorted { $0.name < $1.name }
    }

    private var grouped: [(String, [Artist])] {
        Dictionary(grouping: artists) { String($0.name.prefix(1)).uppercased() }
            .map { ($0.key, $0.value) }
            .sorted { $0.0 < $1.0 }
    }

    private var indexLetters: [String] { grouped.map { $0.0 } }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                        ForEach(grouped, id: \.0) { letter, group in
                            Section {
                                ForEach(group) { artist in
                                    Button { selected = artist } label: {
                                        ArtistRow(artist: artist)
                                    }
                                    .buttonStyle(.plain)
                                }
                            } header: {
                                sectionHeader(letter).id(letter)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 28)
                }
                .background(Color.lbCream.ignoresSafeArea())

                AlphaIndex(letters: indexLetters) { letter in
                    withAnimation { proxy.scrollTo(letter, anchor: .top) }
                    UISelectionFeedbackGenerator().selectionChanged()
                }
            }
        }
        .sheet(item: $selected) { artist in
            ArtistDetailSheet(artist: artist)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func sectionHeader(_ letter: String) -> some View {
        HStack {
            Text(letter)
                .font(.system(size: 38, weight: .regular, design: .serif))
                .foregroundStyle(Color.lbNavy)
                .padding(.horizontal, 4)
            Spacer()
            Text(grouped.first(where: { $0.0 == letter })?.1.count.description ?? "")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.lbNavy.opacity(0.45))
        }
        .padding(.vertical, 8)
        .background(Color.lbCream.opacity(0.95))
    }
}

// MARK: - Artist model

struct Artist: Identifiable, Hashable {
    var id: String { name }
    let name: String
    let primaryStage: String
    let category: String        // "Music" / "Talk" / "Competition"
    var appearances: [Appearance]

    struct Appearance: Hashable {
        let day: String
        let time: String
        let stage: String
    }

    /// Deterministic palette keyed on artist name so cards feel hand-painted but stable.
    var palette: [Color] {
        let h = abs(name.hashValue)
        let palettes: [[Color]] = [
            [Color.lbCoral2, Color.lbYellow],
            [Color.lbNavy, Color(red: 0.18, green: 0.36, blue: 0.55)],
            [Color.lbMint, Color(red: 0.13, green: 0.42, blue: 0.40)],
            [Color.lbYellow, Color(red: 0.94, green: 0.55, blue: 0.20)],
            [Color(red: 0.55, green: 0.18, blue: 0.34), Color.lbCoral2],
            [Color(red: 0.18, green: 0.34, blue: 0.34), Color.lbMint]
        ]
        return palettes[h % palettes.count]
    }

    var category2: String {
        // Tighter casing for chip
        category.uppercased()
    }
}

// MARK: - Artist row

private struct ArtistRow: View {
    let artist: Artist

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                LinearGradient(colors: artist.palette, startPoint: .topLeading, endPoint: .bottomTrailing)
                Text(initial)
                    .font(.system(size: 30, weight: .bold, design: .serif))
                    .italic()
                    .foregroundStyle(Color.white.opacity(0.92))
            }
            .frame(width: 64, height: 64)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.lbNavy.opacity(0.10), lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(artist.name)
                    .font(.system(size: 18, weight: .bold, design: .serif))
                    .foregroundStyle(Color.lbNavy)
                Text(artist.primaryStage)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.lbNavy.opacity(0.55))
                HStack(spacing: 4) {
                    ForEach(Array(artist.appearances.prefix(3).enumerated()), id: \.offset) { _, app in
                        Text("\(String(app.day.prefix(3))) \(app.time)")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(Color.lbNavy.opacity(0.08))
                            .clipShape(Capsule())
                            .foregroundStyle(Color.lbNavy)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.lbNavy.opacity(0.35))
        }
        .padding(12)
        .background(Color.white.opacity(0.78))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.06), lineWidth: 1)
        )
    }

    private var initial: String {
        String(artist.name.prefix(1)).uppercased()
    }
}

// MARK: - Detail sheet

private struct ArtistDetailSheet: View {
    let artist: Artist
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var notifications = NotificationManager.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ZStack(alignment: .bottomLeading) {
                    LinearGradient(colors: artist.palette, startPoint: .topLeading, endPoint: .bottomTrailing)
                        .frame(height: 200)
                    Text(String(artist.name.prefix(1)).uppercased())
                        .font(.system(size: 100, weight: .bold, design: .serif)).italic()
                        .foregroundStyle(Color.white.opacity(0.32))
                        .padding(.leading, 16)
                        .padding(.bottom, -10)
                    Text(artist.category.uppercased())
                        .font(.caption.weight(.bold))
                        .tracking(1.6)
                        .foregroundStyle(Color.lbCream)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Color.lbNavy.opacity(0.7))
                        .clipShape(Capsule())
                        .padding(14)
                }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text(artist.name)
                        .font(.system(size: 32, weight: .regular, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                    Text(artist.primaryStage)
                        .font(.headline.weight(.medium))
                        .foregroundStyle(Color.lbNavy.opacity(0.62))
                }

                Text("APPEARANCES")
                    .font(.caption.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(Color.lbNavy.opacity(0.55))

                ForEach(Array(artist.appearances.enumerated()), id: \.offset) { _, app in
                    HStack {
                        VStack(alignment: .leading) {
                            Text("\(app.day) · \(app.time)")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Color.lbNavy)
                            Text(app.stage)
                                .font(.caption)
                                .foregroundStyle(Color.lbNavy.opacity(0.62))
                        }
                        Spacer()
                    }
                    .padding(12)
                    .background(Color.white.opacity(0.78))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }

                Text("Bio and press photo populate from texassandfest.org once the music lineup is finalized. We hold the same shape as the sculptor sheets — bio, audio teaser, set timelapse — for parity across the app.")
                    .font(.caption)
                    .foregroundStyle(Color.lbNavy.opacity(0.55))
                    .padding(.top, 4)
            }
            .padding(20)
        }
        .background(Color.lbCream.ignoresSafeArea())
    }
}

// MARK: - Sticky alpha index

private struct AlphaIndex: View {
    let letters: [String]
    let onTap: (String) -> Void

    var body: some View {
        VStack(spacing: 2) {
            ForEach(letters, id: \.self) { letter in
                Button { onTap(letter) } label: {
                    Text(letter)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.lbNavy.opacity(0.7))
                        .frame(width: 18, height: 16)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(Color.white.opacity(0.85))
        .clipShape(Capsule())
        .padding(.top, 8)
        .padding(.trailing, 6)
    }
}
