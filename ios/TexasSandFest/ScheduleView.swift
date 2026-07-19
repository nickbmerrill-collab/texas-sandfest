import SwiftUI

// ACL-style schedule:
//   - Day tabs (Friday / Saturday / Sunday)
//   - Optional "My Schedule" filter (only items the user starred)
//   - Star to favorite + tap to schedule a 15-min-before local reminder
//   - Stage chips, set duration bars, category color coding
//
// When the real CSV/sheet schedule lands we replace the SampleData.schedule
// payload — the view doesn't need to change.

enum ScheduleMode: String, CaseIterable, Identifiable {
    case time
    case artist
    var id: String { rawValue }
    var label: String { self == .time ? "BY TIME" : "BY ARTIST" }
}

struct ScheduleView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var notifications = NotificationManager.shared

    @State private var mode: ScheduleMode = ScheduleView.initialMode()
    @State private var selectedDay = "Friday"
    @State private var myScheduleOnly = false
    @State private var permissionAlertVisible = false

    private let days = ["Friday", "Saturday", "Sunday"]

    private var liveSummary: LiveTimeline.LiveSummary {
        LiveTimeline.summarize(dataStore.payload.schedule, guide: dataStore.payload.guide)
    }

    private static func initialMode() -> ScheduleMode {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-scheduleMode"), i + 1 < args.count,
           args[i + 1] == "artist" { return .artist }
        return .time
    }

    private var visibleItems: [ScheduleItem] {
        let dayFiltered = dataStore.payload.schedule.filter { $0.day == selectedDay }
        let starFiltered = myScheduleOnly
            ? dayFiltered.filter { favorites.isStarred($0.id) }
            : dayFiltered
        return starFiltered.sorted { $0.time < $1.time }
    }

    private var starredCount: Int {
        dataStore.payload.schedule.filter {
            $0.day == selectedDay && favorites.isStarred($0.id)
        }.count
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                modeSwitcher
                if mode == .time {
                    if !liveSummary.nowPlaying.isEmpty || !liveSummary.upNext.isEmpty {
                        NowPlayingBanner(summary: liveSummary)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                    }
                    dayPicker
                    myToggleRow
                    Divider().opacity(0.4)
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            if visibleItems.isEmpty {
                                emptyState
                            } else {
                                ForEach(visibleItems) { item in
                                    ScheduleRow(
                                        item: item,
                                        isStarred: favorites.isStarred(item.id),
                                        isLive: liveSummary.nowPlaying.contains { $0.id == item.id },
                                        onStar: { handleStar(item) }
                                    )
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 16)
                    }
                } else {
                    LineupView()
                }
            }
            .background(Color.lbCream.ignoresSafeArea())
            .navigationTitle("Schedule")
            .navigationBarTitleDisplayMode(.large)
            .alert("Turn on notifications", isPresented: $permissionAlertVisible) {
                Button("OK") {}
            } message: {
                Text("To remind you 15 min before your starred sets, enable notifications in Settings → Texas SandFest.")
            }
            .onAppear {
                selectedDay = LiveTimeline.currentFestivalDay(for: dataStore.payload.guide) ?? selectedDay
            }
        }
    }

    private var modeSwitcher: some View {
        HStack(spacing: 8) {
            ForEach(ScheduleMode.allCases) { m in
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) { mode = m }
                } label: {
                    Text(m.label)
                        .font(.caption.weight(.bold))
                        .tracking(1.4)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity)
                        .foregroundStyle(mode == m ? Color.lbCream : Color.lbNavy)
                        .background(mode == m ? Color.lbNavy : Color.white.opacity(0.6))
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    // MARK: Sections

    private var dayPicker: some View {
        HStack(spacing: 8) {
            ForEach(days, id: \.self) { day in
                Button {
                    withAnimation(.easeInOut(duration: 0.18)) { selectedDay = day }
                } label: {
                    let isActive = day == selectedDay
                    HStack(spacing: 6) {
                        Text(day)
                            .font(.subheadline.weight(.semibold))
                        Text(dayDate(for: day))
                            .font(.caption.weight(.medium))
                            .opacity(0.7)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .foregroundStyle(isActive ? Color.lbCream : Color.lbNavy)
                    .background(isActive ? Color.lbNavy : Color.white.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var myToggleRow: some View {
        HStack(spacing: 12) {
            Text("\(visibleItems.count) of \(dataStore.payload.schedule.filter { $0.day == selectedDay }.count) sets · \(starredCount) starred")
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.lbNavy.opacity(0.62))
            Spacer()
            Button {
                withAnimation { myScheduleOnly.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: myScheduleOnly ? "star.fill" : "star")
                        .font(.caption2.weight(.bold))
                    Text(myScheduleOnly ? "MY SCHEDULE" : "ALL SETS")
                        .font(.caption2.weight(.bold))
                        .tracking(1.2)
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .foregroundStyle(myScheduleOnly ? Color.lbCream : Color.lbNavy)
                .background(myScheduleOnly ? Color.lbCoral2 : Color.lbNavy.opacity(0.07))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: myScheduleOnly ? "star" : "calendar")
                .font(.system(size: 40))
                .foregroundStyle(Color.lbNavy.opacity(0.4))
            Text(myScheduleOnly ? "Nothing starred yet" : "No \(selectedDay) sets")
                .font(.headline)
                .foregroundStyle(Color.lbNavy)
            if myScheduleOnly {
                Text("Tap a ☆ on any set to add it to your day. We'll remind you 15 min before.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Color.lbNavy.opacity(0.6))
                    .padding(.horizontal, 24)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(40)
    }

    private func dayDate(for day: String) -> String {
        LiveTimeline.shortDate(for: day, guide: dataStore.payload.guide)
    }

    // MARK: Star handling

    private func handleStar(_ item: ScheduleItem) {
        let willBeStarred = !favorites.isStarred(item.id)
        favorites.toggle(item.id)
        UISelectionFeedbackGenerator().selectionChanged()

        if willBeStarred {
            Task {
                let granted: Bool
                switch notifications.authorization {
                case .authorized, .provisional, .ephemeral:
                    granted = true
                case .notDetermined:
                    granted = await notifications.requestAuthorization()
                case .denied:
                    granted = false
                @unknown default:
                    granted = false
                }

                if granted, let fireDate = scheduledDate(for: item) {
                    await notifications.scheduleReminder(
                        itemId: item.id,
                        title: notificationTitle(for: item),
                        body: notificationBody(for: item),
                        fireDate: fireDate,
                        leadMinutes: 15
                    )
                } else if !granted, notifications.authorization == .denied {
                    permissionAlertVisible = true
                }
            }
        } else {
            notifications.cancelReminder(itemId: item.id)
        }
    }

    private func scheduledDate(for item: ScheduleItem) -> Date? {
        LiveTimeline.date(for: item, guide: dataStore.payload.guide)
    }

    private func notificationTitle(for item: ScheduleItem) -> String {
        if let artist = item.artist { return "\(artist) starts in 15 min" }
        return "\(item.title) in 15 min"
    }

    private func notificationBody(for item: ScheduleItem) -> String {
        if let stage = item.stage {
            return "\(item.title) · \(stage)"
        }
        return "\(item.title) · \(item.zone)"
    }
}

// MARK: - Row

private struct ScheduleRow: View {
    let item: ScheduleItem
    let isStarred: Bool
    let isLive: Bool
    let onStar: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            timeColumn
            VStack(alignment: .leading, spacing: 8) {
                if let artist = item.artist {
                    Text(artist)
                        .font(.system(size: 19, weight: .bold, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                } else {
                    Text(item.title)
                        .font(.system(size: 19, weight: .bold, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                }

                HStack(spacing: 6) {
                    if isLive {
                        livePill
                    }
                    categoryChip
                    if let stage = item.stage {
                        stageChip(stage)
                    } else {
                        Text(item.zone)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Color.lbNavy.opacity(0.62))
                    }
                }

                if let duration = item.durationMinutes {
                    durationBar(duration: duration)
                }
            }
            Spacer(minLength: 0)
            Button(action: onStar) {
                Image(systemName: isStarred ? "star.fill" : "star")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(isStarred ? Color.lbCoral2 : Color.lbNavy.opacity(0.4))
                    .frame(width: 36, height: 36)
                    .background(isStarred ? Color.lbCoral2.opacity(0.10) : Color.clear)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(
            LinearGradient(colors: rowGradient, startPoint: .top, endPoint: .bottom)
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(rowStroke, lineWidth: isLive ? 2 : 1)
        )
    }

    private var rowGradient: [Color] {
        if isLive {
            return [Color.lbCoral2.opacity(0.16), Color.white]
        }
        return [.white, Color.lbYellow.opacity(0.10)]
    }

    private var rowStroke: Color {
        if isLive { return Color.lbCoral2.opacity(0.55) }
        if isStarred { return Color.lbCoral2.opacity(0.4) }
        return Color.lbNavy.opacity(0.08)
    }

    private var livePill: some View {
        HStack(spacing: 4) {
            Circle().fill(Color.lbCoral2).frame(width: 6, height: 6)
            Text("LIVE")
                .font(.caption2.weight(.bold))
                .tracking(1.2)
        }
        .padding(.horizontal, 8).padding(.vertical, 3)
        .background(Color.lbCoral2.opacity(0.18))
        .foregroundStyle(Color(red: 0.42, green: 0.17, blue: 0.07))
        .clipShape(Capsule())
    }

    private var timeColumn: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(item.time)
                .font(.caption.weight(.bold))
                .foregroundStyle(Color.lbNavy)
            if let endTime = item.endTime {
                Text(endTime)
                    .font(.caption2)
                    .foregroundStyle(Color.lbNavy.opacity(0.5))
            }
        }
        .frame(width: 70, alignment: .leading)
    }

    private var categoryChip: some View {
        Text(item.category.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.0)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(categoryColor.opacity(0.18))
            .foregroundStyle(categoryColor)
            .clipShape(Capsule())
    }

    private func stageChip(_ name: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "music.mic").font(.caption2)
            Text(name).font(.caption.weight(.medium))
        }
        .foregroundStyle(Color.lbNavy.opacity(0.62))
    }

    private func durationBar(duration: Int) -> some View {
        let widthFraction = min(1.0, Double(duration) / 120.0) // cap visual at 2h
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.lbNavy.opacity(0.08))
                    .frame(height: 4)
                Capsule()
                    .fill(categoryColor.opacity(0.6))
                    .frame(width: geo.size.width * widthFraction, height: 4)
            }
        }
        .frame(height: 4)
        .padding(.top, 2)
    }

    private var categoryColor: Color {
        switch item.category {
        case "Music":       Color.lbCoral2
        case "Competition": Color.lbNavy
        case "Talk":        Color(red: 0.30, green: 0.40, blue: 0.55)
        case "Family":      Color.lbMint
        case "Sponsor":     Color.lbYellow
        case "Visitor":     Color.lbNavy.opacity(0.6)
        case "Operations":  Color(red: 0.42, green: 0.30, blue: 0.20)
        case "Staff":       Color(red: 0.42, green: 0.42, blue: 0.42)
        default:            Color.lbNavy
        }
    }
}
