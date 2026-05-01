import Foundation

/// Computes which schedule items are currently happening / coming up next.
/// "Now" is normally Date(), but accepts a demo-time override (via launch arg
/// `-demoTime "2026-04-17T13:00:00-05:00"`) so the festival-live UI can be
/// shown outside the festival.
enum LiveTimeline {

    static var now: Date {
        if let arg = CommandLine.arguments.firstIndex(of: "-demoTime"),
           arg + 1 < CommandLine.arguments.count {
            let raw = CommandLine.arguments[arg + 1]
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            if let d = formatter.date(from: raw) { return d }
        }
        // If we're outside the festival window, default to a believable demo
        // moment so the Now-Playing header shows up in screenshots.
        let real = Date()
        let calendar = Calendar(identifier: .gregorian)
        var fest = DateComponents()
        fest.timeZone = TimeZone(identifier: "America/Chicago")
        fest.year = 2026; fest.month = 4; fest.day = 17
        fest.hour = 12; fest.minute = 30
        let demo = calendar.date(from: fest) ?? real
        if real < calendar.date(byAdding: .day, value: 21, to: demo)! &&
           real > calendar.date(byAdding: .day, value: -200, to: demo)! &&
           Calendar.current.dateComponents([.year, .month, .day], from: real) ==
           Calendar.current.dateComponents([.year, .month, .day], from: demo) {
            return real
        }
        return demo
    }

    /// Coerce "Friday 11:30 AM" to an absolute Apr 17, 2026 11:30 AM CDT date.
    static func date(for item: ScheduleItem, useEnd: Bool = false) -> Date? {
        var comps = DateComponents()
        comps.timeZone = TimeZone(identifier: "America/Chicago")
        comps.year = 2026
        switch item.day {
        case "Friday":   comps.month = 4; comps.day = 17
        case "Saturday": comps.month = 4; comps.day = 18
        case "Sunday":   comps.month = 4; comps.day = 19
        default: return nil
        }
        let raw = useEnd ? (item.endTime ?? item.time) : item.time
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        f.timeZone = comps.timeZone
        guard let parsed = f.date(from: raw) else { return nil }
        let tc = Calendar(identifier: .gregorian).dateComponents([.hour, .minute], from: parsed)
        comps.hour = tc.hour
        comps.minute = tc.minute
        return Calendar(identifier: .gregorian).date(from: comps)
    }

    struct LiveSummary {
        let nowPlaying: [ScheduleItem]   // currently happening
        let upNext: [ScheduleItem]       // starting in the next 90 min
        let referenceDate: Date
    }

    static func summarize(_ schedule: [ScheduleItem], at reference: Date = LiveTimeline.now) -> LiveSummary {
        var nowPlaying: [ScheduleItem] = []
        var upNext: [(ScheduleItem, Date)] = []
        let nineMin: TimeInterval = 90 * 60

        for item in schedule {
            guard let start = date(for: item) else { continue }
            // Items without explicit duration default to a 30-min window so
            // gates-open / gates-close still register.
            let durationSeconds: TimeInterval = TimeInterval((item.durationMinutes ?? 30) * 60)
            let end = date(for: item, useEnd: true) ?? start.addingTimeInterval(durationSeconds)

            if reference >= start && reference < end {
                nowPlaying.append(item)
            } else if start > reference && start <= reference.addingTimeInterval(nineMin) {
                upNext.append((item, start))
            }
        }

        let upNextSorted = upNext.sorted { $0.1 < $1.1 }.map { $0.0 }
        return LiveSummary(nowPlaying: nowPlaying, upNext: Array(upNextSorted.prefix(3)), referenceDate: reference)
    }

    /// Minutes left for a "now playing" item, rounded down. nil if it has no end.
    static func minutesLeft(for item: ScheduleItem, at reference: Date = LiveTimeline.now) -> Int? {
        guard let end = date(for: item, useEnd: true) else {
            guard let start = date(for: item),
                  let dur = item.durationMinutes else { return nil }
            let synthetic = start.addingTimeInterval(TimeInterval(dur * 60))
            return max(0, Int(synthetic.timeIntervalSince(reference) / 60))
        }
        return max(0, Int(end.timeIntervalSince(reference) / 60))
    }

    /// Resolves the current festival day name for default selection ("Friday" etc.).
    static func currentFestivalDay(at reference: Date = LiveTimeline.now) -> String? {
        let cal = Calendar(identifier: .gregorian)
        var c = DateComponents()
        c.timeZone = TimeZone(identifier: "America/Chicago")
        c.year = 2026; c.month = 4
        let f17 = cal.date(from: { var x = c; x.day = 17; x.hour = 0; return x }())!
        let f18 = cal.date(from: { var x = c; x.day = 18; x.hour = 0; return x }())!
        let f19 = cal.date(from: { var x = c; x.day = 19; x.hour = 0; return x }())!
        let f20 = cal.date(from: { var x = c; x.day = 20; x.hour = 0; return x }())!
        if reference >= f17 && reference < f18 { return "Friday" }
        if reference >= f18 && reference < f19 { return "Saturday" }
        if reference >= f19 && reference < f20 { return "Sunday" }
        return nil
    }
}
