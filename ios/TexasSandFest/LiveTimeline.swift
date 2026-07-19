import Foundation

/// Computes which schedule items are currently happening / coming up next.
/// "Now" is normally Date(), but accepts a demo-time override (via launch arg
/// `-demoTime "2027-04-16T13:00:00-05:00"`) so the festival-live UI can be
/// shown outside the festival.
enum LiveTimeline {

    static func now(for guide: EventGuide) -> Date {
        if let arg = CommandLine.arguments.firstIndex(of: "-demoTime"),
           arg + 1 < CommandLine.arguments.count {
            let raw = CommandLine.arguments[arg + 1]
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            if let d = formatter.date(from: raw) { return d }
        }
        let real = Date()
        guard let start = localDate(guide.startDate, guide: guide),
              let end = localDate(guide.endDate, guide: guide) else { return real }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: guide)
        let endExclusive = calendar.date(byAdding: .day, value: 1, to: end) ?? end
        if real >= start && real < endExclusive {
            return real
        }

        // Outside the event window, use a deterministic event-day moment so
        // the board/demo build still presents the live schedule affordances.
        return calendar.date(bySettingHour: 12, minute: 30, second: 0, of: start) ?? start
    }

    static func date(for item: ScheduleItem, guide: EventGuide, useEnd: Bool = false) -> Date? {
        guard let eventDay = eventDate(for: item.day, guide: guide) else { return nil }
        let raw = useEnd ? (item.endTime ?? item.time) : item.time
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "h:mm a"
        formatter.timeZone = timeZone(for: guide)
        guard let parsed = formatter.date(from: raw) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: guide)
        let time = calendar.dateComponents([.hour, .minute], from: parsed)
        return calendar.date(bySettingHour: time.hour ?? 0, minute: time.minute ?? 0, second: 0, of: eventDay)
    }

    struct LiveSummary {
        let nowPlaying: [ScheduleItem]   // currently happening
        let upNext: [ScheduleItem]       // starting in the next 90 min
        let referenceDate: Date
        let guide: EventGuide
    }

    static func summarize(_ schedule: [ScheduleItem], guide: EventGuide, at suppliedReference: Date? = nil) -> LiveSummary {
        let reference = suppliedReference ?? now(for: guide)
        var nowPlaying: [ScheduleItem] = []
        var upNext: [(ScheduleItem, Date)] = []
        let nineMin: TimeInterval = 90 * 60

        for item in schedule {
            guard let start = date(for: item, guide: guide) else { continue }
            // Items without explicit duration default to a 30-min window so
            // gates-open / gates-close still register.
            let durationSeconds: TimeInterval = TimeInterval((item.durationMinutes ?? 30) * 60)
            let end = date(for: item, guide: guide, useEnd: true) ?? start.addingTimeInterval(durationSeconds)

            if reference >= start && reference < end {
                nowPlaying.append(item)
            } else if start > reference && start <= reference.addingTimeInterval(nineMin) {
                upNext.append((item, start))
            }
        }

        let upNextSorted = upNext.sorted { $0.1 < $1.1 }.map { $0.0 }
        return LiveSummary(nowPlaying: nowPlaying, upNext: Array(upNextSorted.prefix(3)), referenceDate: reference, guide: guide)
    }

    /// Minutes left for a "now playing" item, rounded down. nil if it has no end.
    static func minutesLeft(for item: ScheduleItem, guide: EventGuide, at suppliedReference: Date? = nil) -> Int? {
        let reference = suppliedReference ?? now(for: guide)
        guard let end = date(for: item, guide: guide, useEnd: true) else {
            guard let start = date(for: item, guide: guide),
                  let dur = item.durationMinutes else { return nil }
            let synthetic = start.addingTimeInterval(TimeInterval(dur * 60))
            return max(0, Int(synthetic.timeIntervalSince(reference) / 60))
        }
        return max(0, Int(end.timeIntervalSince(reference) / 60))
    }

    /// Resolves the current festival day name for default selection ("Friday" etc.).
    static func currentFestivalDay(for guide: EventGuide, at suppliedReference: Date? = nil) -> String? {
        let reference = suppliedReference ?? now(for: guide)
        guard let start = localDate(guide.startDate, guide: guide),
              let end = localDate(guide.endDate, guide: guide) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: guide)
        var day = start
        while day <= end {
            let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
            if reference >= day && reference < next { return weekdayName(for: day, guide: guide) }
            day = next
        }
        return nil
    }

    static func shortDate(for day: String, guide: EventGuide) -> String {
        guard let date = eventDate(for: day, guide: guide) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone(for: guide)
        formatter.dateFormat = "MMM d"
        return formatter.string(from: date)
    }

    static func eventYear(for guide: EventGuide) -> String {
        guard let date = localDate(guide.startDate, guide: guide) else {
            return guide.dateRange.split(separator: " ").last.map(String.init) ?? ""
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone(for: guide)
        formatter.dateFormat = "yyyy"
        return formatter.string(from: date)
    }

    static func shortDateRange(for guide: EventGuide) -> String {
        guard let start = localDate(guide.startDate, guide: guide),
              let end = localDate(guide.endDate, guide: guide) else { return guide.dateRange }
        let month = DateFormatter()
        month.locale = Locale(identifier: "en_US_POSIX")
        month.timeZone = timeZone(for: guide)
        month.dateFormat = "MMM"
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: guide)
        let startDay = calendar.component(.day, from: start)
        let endDay = calendar.component(.day, from: end)
        return "\(month.string(from: start)) \(startDay)-\(endDay)"
    }

    private static func eventDate(for weekday: String, guide: EventGuide) -> Date? {
        guard let start = localDate(guide.startDate, guide: guide),
              let end = localDate(guide.endDate, guide: guide) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone(for: guide)
        var candidate = start
        while candidate <= end {
            if weekdayName(for: candidate, guide: guide) == weekday { return candidate }
            guard let next = calendar.date(byAdding: .day, value: 1, to: candidate) else { return nil }
            candidate = next
        }
        return nil
    }

    private static func weekdayName(for date: Date, guide: EventGuide) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone(for: guide)
        formatter.dateFormat = "EEEE"
        return formatter.string(from: date)
    }

    private static func localDate(_ raw: String?, guide: EventGuide) -> Date? {
        guard let raw else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone(for: guide)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: raw)
    }

    private static func timeZone(for guide: EventGuide) -> TimeZone {
        TimeZone(identifier: guide.timeZone ?? "America/Chicago") ?? TimeZone(secondsFromGMT: 0)!
    }
}
