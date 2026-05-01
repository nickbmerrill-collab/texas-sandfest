import SwiftUI

/// Festival-time hero banner. Surfaces the currently-live set + what's up next.
/// Hides itself when nothing's playing and nothing is starting in the next 90
/// minutes, so this never feels empty.
struct NowPlayingBanner: View {
    let summary: LiveTimeline.LiveSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let live = summary.nowPlaying.first {
                liveBlock(live)
            }
            if !summary.upNext.isEmpty {
                upNextBlock
            }
        }
        .padding(14)
        .background(
            LinearGradient(
                colors: [Color.lbNavy, Color(red: 0.10, green: 0.20, blue: 0.36)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.lbYellow.opacity(0.20), lineWidth: 1)
        )
        .shadow(color: Color.lbNavy.opacity(0.3), radius: 18, x: 0, y: 8)
    }

    private func liveBlock(_ item: ScheduleItem) -> some View {
        let minutesLeft = LiveTimeline.minutesLeft(for: item, at: summary.referenceDate)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(Color.lbCoral2).frame(width: 8, height: 8)
                        .overlay(
                            Circle()
                                .stroke(Color.lbCoral2.opacity(0.4), lineWidth: 4)
                                .scaleEffect(2.2)
                                .opacity(0.6)
                        )
                    Text("LIVE NOW")
                        .font(.caption.weight(.bold))
                        .tracking(1.6)
                        .foregroundStyle(Color.lbCoral2)
                }
                Text(item.artist ?? item.title)
                    .font(.system(size: 24, weight: .bold, design: .serif))
                    .foregroundStyle(Color.lbCream)
                    .lineLimit(2)
                Text(headline(for: item))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.lbCream.opacity(0.78))
            }
            Spacer(minLength: 0)
            if let m = minutesLeft, m > 0 {
                VStack(alignment: .trailing, spacing: 0) {
                    Text("\(m)").font(.system(size: 36, weight: .bold, design: .serif)).foregroundStyle(Color.lbYellow)
                    Text("min left").font(.caption2.weight(.semibold)).tracking(1.2).foregroundStyle(Color.lbCream.opacity(0.7))
                }
            }
        }
    }

    private var upNextBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("UP NEXT")
                .font(.caption2.weight(.bold))
                .tracking(1.6)
                .foregroundStyle(Color.lbCream.opacity(0.55))
            ForEach(summary.upNext) { item in
                HStack(spacing: 10) {
                    Text(item.time)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.lbYellow)
                        .frame(width: 60, alignment: .leading)
                    Text(item.artist ?? item.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.lbCream)
                    Spacer(minLength: 0)
                    if let stage = item.stage {
                        Text(stage)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Color.lbCream.opacity(0.55))
                    }
                }
            }
        }
        .padding(.top, 6)
        .padding(.horizontal, 2)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.lbCream.opacity(0.15))
                .frame(height: 1)
        }
    }

    private func headline(for item: ScheduleItem) -> String {
        var parts: [String] = []
        if let stage = item.stage { parts.append(stage) }
        if !item.zone.isEmpty && parts.first != item.zone { parts.append(item.zone) }
        if let end = item.endTime { parts.append("ends \(end)") }
        return parts.joined(separator: " · ")
    }
}
