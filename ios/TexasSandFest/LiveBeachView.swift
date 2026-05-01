import SwiftUI

// MARK: - Live Beach
//
// The visitor-facing WOW surface. Fuses live crowd-zone density (heat blooms +
// pin coloring), run-of-show (the "talk in N min" countdown and timeline
// scrubber), the sculpture map (16 numbered pins), and the Ask Sandy concierge
// (the routed "skip the south plaza" recommendation) into one screen.
//
// Mirrors the web `live-beach` section in src/main.js and src/styles.css.

struct LiveBeachView: View {
    @State private var snapshot: LiveBeachSnapshot = SampleData.liveBeach
    @State private var selectedSculptureId: Int? = nil
    @State private var sheetSculpture: Sculpture? = nil
    @State private var routeTargetId: Int = SampleData.liveBeach.suggestion.targetId
    @State private var scrubIndex: Double = LiveBeachView.initialScrubIndex()
    @State private var secondsToTalk: Int = SampleData.liveBeach.suggestion.eventStartsInMin * 60
    @State private var pinsAppeared: Bool = false
    private let countdownTick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    /// Pull -scrubFrame N off CommandLine for demo mode (e.g., 10 = 7 PM sunset).
    private static func initialScrubIndex() -> Double {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "-scrubFrame"), i + 1 < args.count, let n = Double(args[i + 1]) {
            return n
        }
        return 3
    }

    private var suggestedSculpture: Sculpture {
        snapshot.sculptures.first { $0.id == snapshot.suggestion.targetId } ?? snapshot.sculptures[0]
    }

    private var currentFrame: TimelineFrame {
        snapshot.timeline[min(snapshot.timeline.count - 1, max(0, Int(scrubIndex.rounded())))]
    }

    // Soft palette tint to apply as the day moves toward sunset.
    private var paletteTint: PaletteTint {
        switch currentFrame.preset {
        case "evening": .sunset
        case "peak":    .midday
        default:        .day
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    BeachMapCanvas(
                        snapshot: snapshot,
                        routeTargetId: routeTargetId,
                        preset: currentFrame.preset,
                        tint: paletteTint,
                        pinsAppeared: pinsAppeared,
                        selectedSculptureId: $selectedSculptureId,
                        onPinTap: { id in
                            selectedSculptureId = id
                            if let s = snapshot.sculptures.first(where: { $0.id == id }) {
                                sheetSculpture = s
                            }
                            UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                        }
                    )
                    .frame(maxWidth: .infinity)
                    .aspectRatio(16.0 / 10.0, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(Color.lbNavy.opacity(0.10), lineWidth: 1)
                    )
                    .shadow(color: Color.lbNavy.opacity(0.22), radius: 28, x: 0, y: 16)
                    .padding(.horizontal, 4)
                    .onAppear {
                        // Stagger the pin entrance for a cinematic open
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                            withAnimation(.easeOut(duration: 0.85)) {
                                pinsAppeared = true
                            }
                        }
                    }

                    sandySuggestsCard
                    quickStats
                    nowOnBeachFeed
                    timelineScrubber
                    footer
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .background(liveBeachBackground.ignoresSafeArea())
            .navigationTitle("Live Beach")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onReceive(countdownTick) { _ in
            if secondsToTalk > 0 { secondsToTalk -= 1 }
        }
        .sheet(item: $sheetSculpture) { s in
            SculptureDetailSheet(
                sculpture: s,
                walkMinutes: Int(((Double(s.x) - snapshot.visitor.x) * (Double(s.x) - snapshot.visitor.x) + (Double(s.y) - snapshot.visitor.y) * (Double(s.y) - snapshot.visitor.y)).squareRoot() * 18),
                onWalk: {
                    routeTargetId = s.id
                    selectedSculptureId = s.id
                    sheetSculpture = nil
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }

    private var liveBeachBackground: some View {
        ZStack {
            paletteTint.background
            RadialGradient(
                gradient: Gradient(colors: [Color.white.opacity(0.5), paletteTint.background.opacity(0)]),
                center: .top,
                startRadius: 80,
                endRadius: 700
            )
                .animation(.easeInOut(duration: 0.6), value: paletteTint)
        }
        .animation(.easeInOut(duration: 0.6), value: paletteTint)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                LivePill()
                Text("LIVE BEACH · MUSTANG ISLAND")
                    .font(.caption.weight(.semibold))
                    .tracking(2)
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
            }

            (Text("Walk the festival like\nyou have a ")
                .foregroundStyle(Color.lbNavy)
             + Text("superpower.")
                .italic()
                .foregroundStyle(Color.lbCoral2))
                .font(.system(size: 32, weight: .regular, design: .serif))
                .lineSpacing(2)

            Text("One screen fuses live crowd density, the run of show, the sculpture map, and Sandy's routing. Tap a pin to learn the artist.")
                .font(.subheadline)
                .foregroundStyle(Color.lbNavy.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 8)
    }

    // MARK: Sandy Suggests

    private var sandySuggestsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.lbYellow)
                    Text("✦").font(.system(size: 18, weight: .bold)).foregroundStyle(Color.lbNavy)
                }
                .frame(width: 36, height: 36)

                VStack(alignment: .leading, spacing: 2) {
                    Text("SANDY SUGGESTS")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.6)
                        .foregroundStyle(Color.lbNavy.opacity(0.62))
                    Text("Right now").font(.system(size: 22, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                }
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text("SCULPTURE")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.4)
                        .foregroundStyle(Color.lbNavy.opacity(0.62))
                    Text("#\(suggestedSculpture.id)").font(.caption.weight(.bold)).foregroundStyle(Color.lbNavy)
                    Text(suggestedSculpture.country)
                    Spacer(minLength: 0)
                }

                Text(suggestedSculpture.title)
                    .font(.system(size: 26, design: .serif))
                    .italic()
                    .foregroundStyle(Color.lbNavy)
                    .fixedSize(horizontal: false, vertical: true)

                Text(suggestedSculpture.sculptor)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Color.lbNavy.opacity(0.62))

                Text(snapshot.suggestion.reason)
                    .font(.callout)
                    .foregroundStyle(Color.lbNavy.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    Chip(text: "\(snapshot.suggestion.walkMinutes) min walk", icon: "arrow.up.right", tone: .mint)
                    Chip(text: "Talk in \(max(0, Int(ceil(Double(secondsToTalk) / 60.0)))) min", icon: nil, tone: .coral, pulsing: true)
                    Spacer(minLength: 0)
                }

                Button {
                    routeTargetId = snapshot.suggestion.targetId
                    selectedSculptureId = snapshot.suggestion.targetId
                } label: {
                    HStack(spacing: 8) {
                        Text("Start walking")
                            .font(.subheadline.weight(.semibold))
                        Image(systemName: "arrow.right")
                            .font(.caption.weight(.bold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .foregroundStyle(Color.lbCream)
                    .background(Color.lbNavy)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
            .background(
                LinearGradient(
                    colors: [Color.white, Color.lbYellow.opacity(0.18)],
                    startPoint: .top, endPoint: .bottom
                )
            )
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
            )
        }
        .padding(16)
        .background(
            Color.white.opacity(0.78)
                .background(.ultraThinMaterial)
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: Quick stats

    private var quickStats: some View {
        let items: [(String, String)] = [
            ("TIDE", "+2.4 ft ↑"),
            ("SUNSET", "2h 47m"),
            ("STAGE A NEXT", "Coastal Roots"),
            ("AIR", "78°F · NE 9")
        ]
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 14) {
            ForEach(items, id: \.0) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.0)
                        .font(.caption2.weight(.semibold))
                        .tracking(1.6)
                        .foregroundStyle(Color.lbNavy.opacity(0.62))
                    Text(item.1)
                        .font(.system(size: 22, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.78))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: Now on the beach

    private var nowOnBeachFeed: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(Color.lbCoral2)
                    Circle().fill(Color.lbCoral2.opacity(0.4)).scaleEffect(1.6)
                }
                .frame(width: 12, height: 12)
                Text("NOW ON THE BEACH")
                    .font(.caption.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
                Spacer(minLength: 0)
                Text("Updated · just now")
                    .font(.system(size: 16, design: .serif))
                    .foregroundStyle(Color.lbNavy)
            }
            ForEach(Array(snapshot.nowOnBeach.enumerated()), id: \.element.id) { idx, card in
                NowOnBeachRow(card: card, paletteIndex: idx) {
                    if let pin = card.pinId {
                        routeTargetId = pin
                        selectedSculptureId = pin
                    }
                }
            }
        }
    }

    // MARK: Timeline

    private var timelineScrubber: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("FESTIVAL TIMELINE")
                    .font(.caption2.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
                Spacer()
                Text("\(currentFrame.hour) · \(currentFrame.label)")
                    .font(.system(size: 18, design: .serif))
                    .foregroundStyle(Color.lbNavy)
            }
            ZStack(alignment: .leading) {
                Capsule().fill(Color.lbNavy.opacity(0.10)).frame(height: 6)
                GeometryReader { geo in
                    let width = max(0, geo.size.width)
                    let count = max(1, snapshot.timeline.count - 1)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [Color.lbMint, Color.lbYellow, Color.lbCoral2],
                                startPoint: .leading, endPoint: .trailing
                            )
                        )
                        .frame(width: width * (scrubIndex / Double(count)), height: 6)
                }
                .frame(height: 6)
            }
            Slider(
                value: $scrubIndex,
                in: 0...Double(max(0, snapshot.timeline.count - 1)),
                step: 1
            )
            .tint(Color.lbNavy)
            HStack {
                ForEach(Array(snapshot.timeline.enumerated()), id: \.element.id) { idx, frame in
                    if idx % 3 == 0 {
                        Text(frame.hour)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(Color.lbNavy.opacity(0.62))
                            .frame(maxWidth: .infinity, alignment: idx == 0 ? .leading : (idx == snapshot.timeline.count - 1 ? .trailing : .center))
                    }
                }
            }
        }
        .padding(18)
        .background(Color.white.opacity(0.78))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: Footer

    private var footer: some View {
        Text("Live Beach is a public-facing surface that fuses the ops crowd-zone API, run-of-show, sculpture map, and Ask Sandy concierge.")
            .font(.caption)
            .foregroundStyle(Color.lbNavy.opacity(0.62))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)
    }
}

// MARK: - Live pill

private struct LivePill: View {
    @State private var pulsing = false

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.lbCoral2)
                .frame(width: 8, height: 8)
                .overlay(
                    Circle()
                        .stroke(Color.lbCoral2.opacity(0.5), lineWidth: pulsing ? 6 : 0)
                        .scaleEffect(pulsing ? 2.2 : 1.0)
                        .opacity(pulsing ? 0 : 1)
                        .animation(.easeOut(duration: 1.6).repeatForever(autoreverses: false), value: pulsing)
                )
            Text("LIVE")
                .font(.caption2.weight(.bold))
                .tracking(2)
                .foregroundStyle(Color.lbCream)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.lbNavy)
        .clipShape(Capsule())
        .onAppear { pulsing = true }
    }
}

// MARK: - Chip

private struct Chip: View {
    enum Tone { case mint, coral, neutral }
    let text: String
    let icon: String?
    let tone: Tone
    var pulsing: Bool = false

    @State private var pulseFlag = false

    var body: some View {
        HStack(spacing: 6) {
            if pulsing {
                Circle()
                    .fill(Color.lbCoral2)
                    .frame(width: 7, height: 7)
                    .scaleEffect(pulseFlag ? 1.0 : 0.6)
                    .animation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true), value: pulseFlag)
                    .onAppear { pulseFlag = true }
            } else if let icon {
                Image(systemName: icon).font(.caption2.weight(.bold))
            }
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .foregroundStyle(foreground)
        .background(background)
        .clipShape(Capsule())
    }

    private var background: Color {
        switch tone {
        case .mint:    Color.lbMint.opacity(0.20)
        case .coral:   Color.lbCoral2.opacity(0.18)
        case .neutral: Color.lbNavy.opacity(0.07)
        }
    }
    private var foreground: Color {
        switch tone {
        case .mint:    Color.lbNavy
        case .coral:   Color(red: 0.42, green: 0.17, blue: 0.07)
        case .neutral: Color.lbNavy
        }
    }
}

// MARK: - Now-on-the-beach row

private struct NowOnBeachRow: View {
    let card: NowOnBeachCard
    let paletteIndex: Int
    let onTap: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            thumb
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(card.kind.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(1.6)
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
                Text(card.title)
                    .font(.system(size: 18, design: .serif)).italic()
                    .foregroundStyle(Color.lbNavy)
                Text(card.meta)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
                Text(card.caption)
                    .font(.caption)
                    .foregroundStyle(Color.lbNavy.opacity(0.78))
                    .padding(.top, 2)
                if card.pinId != nil {
                    Button(action: onTap) {
                        HStack(spacing: 4) {
                            Text("Take me there")
                            Image(systemName: "arrow.right").font(.caption2.weight(.bold))
                        }
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .foregroundStyle(Color.lbNavy)
                        .overlay(
                            Capsule().stroke(Color.lbNavy, lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                } else {
                    Text("LIVE")
                        .font(.caption2.weight(.bold))
                        .tracking(1.6)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.lbCoral2.opacity(0.18))
                        .foregroundStyle(Color(red: 0.42, green: 0.17, blue: 0.07))
                        .clipShape(Capsule())
                        .padding(.top, 6)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            LinearGradient(
                colors: [Color.white, Color.lbYellow.opacity(0.10)],
                startPoint: .top, endPoint: .bottom
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
        )
    }

    private var thumb: some View {
        switch paletteIndex % 3 {
        case 0:
            return AnyView(LinearGradient(colors: [Color.lbYellow, Color.lbCoral2], startPoint: .topLeading, endPoint: .bottomTrailing))
        case 1:
            return AnyView(LinearGradient(colors: [Color.lbNavy, Color(red: 0.11, green: 0.28, blue: 0.47)], startPoint: .topLeading, endPoint: .bottomTrailing))
        default:
            return AnyView(LinearGradient(colors: [Color.lbMint, Color(red: 0.17, green: 0.55, blue: 0.46)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
    }
}

// MARK: - Palette tint

enum PaletteTint: Equatable {
    case day, midday, sunset

    var background: Color {
        switch self {
        case .day:    Color.lbCream
        case .midday: Color(red: 1.00, green: 0.96, blue: 0.88)
        case .sunset: Color(red: 0.99, green: 0.90, blue: 0.85)
        }
    }
    var sandTop: Color {
        switch self {
        case .day:    Color.lbSand
        case .midday: Color(red: 1.00, green: 0.93, blue: 0.78)
        case .sunset: Color(red: 0.99, green: 0.86, blue: 0.74)
        }
    }
    var sandBottom: Color {
        switch self {
        case .day:    Color(red: 0.97, green: 0.91, blue: 0.78)
        case .midday: Color(red: 0.96, green: 0.87, blue: 0.70)
        case .sunset: Color(red: 0.92, green: 0.74, blue: 0.61)
        }
    }
    var skyTop: Color {
        switch self {
        case .day:    Color(red: 0.93, green: 0.91, blue: 0.78)
        case .midday: Color(red: 0.96, green: 0.87, blue: 0.59)
        case .sunset: Color(red: 0.78, green: 0.43, blue: 0.49)
        }
    }
    var skyBottom: Color {
        switch self {
        case .day:    Color.lbCream
        case .midday: Color(red: 1.00, green: 0.95, blue: 0.84)
        case .sunset: Color(red: 0.99, green: 0.78, blue: 0.61)
        }
    }
    var water: Color {
        switch self {
        case .day:    Color.lbNavy
        case .midday: Color(red: 0.05, green: 0.20, blue: 0.36)
        case .sunset: Color(red: 0.10, green: 0.12, blue: 0.32)
        }
    }
    var horizonGlow: Color {
        switch self {
        case .day:    Color.white.opacity(0.4)
        case .midday: Color.lbYellow.opacity(0.55)
        case .sunset: Color(red: 1.0, green: 0.55, blue: 0.40).opacity(0.7)
        }
    }
}

// MARK: - Beach map canvas

private struct BeachMapCanvas: View {
    let snapshot: LiveBeachSnapshot
    let routeTargetId: Int
    let preset: String
    let tint: PaletteTint
    let pinsAppeared: Bool
    @Binding var selectedSculptureId: Int?
    let onPinTap: (Int) -> Void

    private var bloomOpacity: Double {
        switch preset {
        case "early":    0.45
        case "rising":   0.75
        case "balanced": 0.92
        case "peak":     1.00
        case "evening":  0.65
        default:         0.85
        }
    }

    private var targetSculpture: Sculpture {
        snapshot.sculptures.first { $0.id == routeTargetId } ?? snapshot.sculptures[0]
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // Painted base — sky, dunes, sand bands, blooms, water, foam, dune grass, umbrellas
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { context in
                    let t = context.date.timeIntervalSince1970
                    Canvas(opaque: true) { ctx, size in
                        drawScene(ctx: &ctx, size: size, time: t)
                    }
                }
                .background(tint.background)

                // Route + walker dot
                RouteWithWalker(
                    from: snapshot.visitor,
                    to: targetSculpture
                )

                // Visitor "you are here"
                visitorPin(in: geo.size)

                // Sculpture pins (overlaid Views so they're tappable)
                ForEach(Array(snapshot.sculptures.enumerated()), id: \.element.id) { idx, s in
                    SculpturePinView(
                        sculpture: s,
                        isSelected: selectedSculptureId == s.id
                    )
                    .scaleEffect(pinsAppeared ? 1 : 0.2)
                    .opacity(pinsAppeared ? 1 : 0)
                    .animation(
                        .spring(response: 0.55, dampingFraction: 0.7).delay(Double(idx) * 0.04),
                        value: pinsAppeared
                    )
                    .position(
                        x: CGFloat(s.x) * geo.size.width,
                        y: CGFloat(s.y) * geo.size.height
                    )
                    .onTapGesture { onPinTap(s.id) }
                }
            }
            .animation(.easeInOut(duration: 0.7), value: tint)
        }
    }

    private func visitorPin(in size: CGSize) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
            let t = ctx.date.timeIntervalSince1970
            let pulse = 0.85 + 0.15 * sin(t * 2.4)
            ZStack {
                Circle().fill(Color.lbNavy.opacity(0.20)).frame(width: 44, height: 44).scaleEffect(pulse)
                Circle().fill(Color.lbNavy.opacity(0.30)).frame(width: 26, height: 26)
                Circle().fill(Color.lbNavy).frame(width: 18, height: 18)
                    .overlay(Circle().stroke(Color.lbYellow, lineWidth: 3))
            }
            .position(
                x: CGFloat(snapshot.visitor.x) * size.width,
                y: CGFloat(snapshot.visitor.y) * size.height
            )
        }
    }

    // MARK: Canvas scene

    private func drawScene(ctx: inout GraphicsContext, size: CGSize, time: Double) {
        let w = size.width
        let h = size.height

        // Sky band gradient
        ctx.fill(
            Path(CGRect(x: 0, y: 0, width: w, height: h * 0.30)),
            with: .linearGradient(
                Gradient(colors: [tint.skyTop, tint.skyBottom]),
                startPoint: .zero,
                endPoint: CGPoint(x: 0, y: h * 0.30)
            )
        )

        // Distant dunes ridge
        var farDunes = Path()
        farDunes.move(to: CGPoint(x: 0, y: h * 0.27))
        let farSteps = 40
        for i in 0...farSteps {
            let x = w * Double(i) / Double(farSteps)
            let phase = Double(i) * 0.35
            let dy = sin(phase) * 6 + sin(phase * 1.7) * 4
            farDunes.addLine(to: CGPoint(x: x, y: h * 0.27 + dy))
        }
        farDunes.addLine(to: CGPoint(x: w, y: h * 0.33))
        farDunes.addLine(to: CGPoint(x: 0, y: h * 0.33))
        farDunes.closeSubpath()
        ctx.fill(farDunes, with: .color(tint.sandBottom.opacity(0.55)))

        // Near dunes silhouette
        var dunes = Path()
        dunes.move(to: CGPoint(x: 0, y: h * 0.30))
        let duneSteps = 60
        for i in 0...duneSteps {
            let x = w * Double(i) / Double(duneSteps)
            let phase = Double(i) * 0.42
            let dy = sin(phase) * 14 + sin(phase * 0.5) * 10 + sin(phase * 2.1) * 4
            dunes.addLine(to: CGPoint(x: x, y: h * 0.30 + dy + 14))
        }
        dunes.addLine(to: CGPoint(x: w, y: h * 0.36))
        dunes.addLine(to: CGPoint(x: 0, y: h * 0.36))
        dunes.closeSubpath()
        ctx.fill(dunes, with: .color(Color.lbDune.opacity(0.62)))

        // Dune grass tufts
        for i in 0..<22 {
            let x = w * Double(i) / 22 + Double((i * 19) % 13) - 6
            let y = h * 0.32 + sin(Double(i) * 0.92) * 8
            for blade in 0..<5 {
                var stalk = Path()
                let bx = x + Double(blade) * 1.6 - 4
                stalk.move(to: CGPoint(x: bx, y: y))
                stalk.addQuadCurve(
                    to: CGPoint(x: bx + Double(blade - 2) * 2.2, y: y - 9 - Double(blade % 2) * 3),
                    control: CGPoint(x: bx + Double(blade - 2) * 0.5, y: y - 6)
                )
                ctx.stroke(stalk, with: .color(Color(red: 0.42, green: 0.47, blue: 0.30).opacity(0.55)), lineWidth: 1)
            }
        }

        // Sand band — gradient from top to bottom
        ctx.fill(
            Path(CGRect(x: 0, y: h * 0.30, width: w, height: h * 0.50)),
            with: .linearGradient(
                Gradient(colors: [tint.sandTop, tint.sandBottom.opacity(0.92)]),
                startPoint: CGPoint(x: 0, y: h * 0.30),
                endPoint: CGPoint(x: 0, y: h * 0.80)
            )
        )

        // Subtle sand ripple bands
        for band in stride(from: 0.36, through: 0.74, by: 0.06) {
            var ripple = Path()
            let baseY = h * band
            ripple.move(to: CGPoint(x: 0, y: baseY))
            for i in 0...80 {
                let x = w * Double(i) / 80
                let dy = sin(Double(i) * 0.18 + band * 6) * 1.4
                ripple.addLine(to: CGPoint(x: x, y: baseY + dy))
            }
            ctx.stroke(ripple, with: .color(tint.sandBottom.opacity(0.16)), lineWidth: 1)
        }

        // Heat blooms
        for bloom in snapshot.blooms {
            let cx = CGFloat(bloom.x) * w
            let cy = CGFloat(bloom.y) * h
            let pulse = 0.95 + 0.08 * sin(time * 0.9 + bloom.x * 6)
            let baseRadius: CGFloat = min(w, h) * 0.20
            let radius = baseRadius * CGFloat(pulse)
            let color = bloomColor(bloom.hue).opacity(bloomOpacity * bloom.intensity)
            let rect = CGRect(x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2)
            ctx.fill(
                Path(ellipseIn: rect),
                with: .radialGradient(
                    Gradient(stops: [
                        .init(color: color, location: 0),
                        .init(color: color.opacity(0.0), location: 1)
                    ]),
                    center: CGPoint(x: cx, y: cy),
                    startRadius: 0,
                    endRadius: radius
                )
            )
        }

        // Umbrella silhouettes near packed pins (pure decoration; reads as a busy festival)
        for s in snapshot.sculptures where s.crowd == .packed {
            let baseX = CGFloat(s.x) * w
            let baseY = CGFloat(s.y) * h
            for offsetIdx in 0..<3 {
                let dx = CGFloat([-22, 16, -8][offsetIdx])
                let dy = CGFloat([12, 18, -10][offsetIdx])
                drawUmbrella(
                    ctx: &ctx,
                    at: CGPoint(x: baseX + dx, y: baseY + dy),
                    color: [Color.lbCoral2, Color.lbYellow, Color.lbMint][offsetIdx]
                )
            }
        }

        // Horizon glow strip just above the surf line
        let horizonY = h * 0.79
        ctx.fill(
            Path(CGRect(x: 0, y: horizonY - 12, width: w, height: 24)),
            with: .linearGradient(
                Gradient(colors: [tint.horizonGlow.opacity(0), tint.horizonGlow, tint.horizonGlow.opacity(0)]),
                startPoint: CGPoint(x: 0, y: horizonY),
                endPoint: CGPoint(x: w, y: horizonY)
            )
        )

        // Tide ribbons (animated sine waves, 12s loop)
        drawTide(ctx: &ctx, size: size, time: time, baseY: 0.80, color: tint.water.opacity(0.92), amplitude: 10, period: 12, phaseOffset: 0)
        drawTide(ctx: &ctx, size: size, time: time, baseY: 0.86, color: tint.water.opacity(0.65), amplitude: 13, period: 14, phaseOffset: 0.6)
        drawTide(ctx: &ctx, size: size, time: time, baseY: 0.93, color: Color.lbMint.opacity(0.22), amplitude: 8,  period: 17, phaseOffset: 1.2)

        // Sunset glow on water (only at sunset)
        if tint == .sunset {
            var glow = Path()
            glow.addEllipse(in: CGRect(x: w * 0.6, y: h * 0.78, width: w * 0.5, height: 14))
            ctx.fill(
                glow,
                with: .radialGradient(
                    Gradient(colors: [Color(red: 1.0, green: 0.66, blue: 0.45).opacity(0.55), Color.clear]),
                    center: CGPoint(x: w * 0.85, y: h * 0.82),
                    startRadius: 4,
                    endRadius: w * 0.35
                )
            )
        }

        // Foam line
        var foam = Path()
        let baseY = h * 0.795
        foam.move(to: CGPoint(x: 0, y: baseY))
        let steps = 60
        for i in 0...steps {
            let x = w * Double(i) / Double(steps)
            let dy = sin((Double(i) / Double(steps)) * .pi * 8 + time * 0.5) * 3
            foam.addLine(to: CGPoint(x: x, y: baseY + dy))
        }
        ctx.stroke(foam, with: .color(Color.lbCream.opacity(0.65)), lineWidth: 2)
    }

    private func drawUmbrella(ctx: inout GraphicsContext, at p: CGPoint, color: Color) {
        // Pole
        var pole = Path()
        pole.move(to: CGPoint(x: p.x, y: p.y))
        pole.addLine(to: CGPoint(x: p.x, y: p.y + 10))
        ctx.stroke(pole, with: .color(Color.lbNavy.opacity(0.6)), lineWidth: 1.2)

        // Canopy
        var canopy = Path()
        canopy.move(to: CGPoint(x: p.x - 9, y: p.y))
        canopy.addQuadCurve(
            to: CGPoint(x: p.x + 9, y: p.y),
            control: CGPoint(x: p.x, y: p.y - 11)
        )
        canopy.closeSubpath()
        ctx.fill(canopy, with: .color(color.opacity(0.85)))
        ctx.stroke(canopy, with: .color(Color.lbNavy.opacity(0.45)), lineWidth: 0.8)

        // Stripe
        var stripe = Path()
        stripe.move(to: CGPoint(x: p.x, y: p.y - 11))
        stripe.addLine(to: CGPoint(x: p.x, y: p.y))
        ctx.stroke(stripe, with: .color(Color.lbCream.opacity(0.5)), lineWidth: 0.5)
    }

    private func drawTide(ctx: inout GraphicsContext, size: CGSize, time: Double, baseY: Double, color: Color, amplitude: Double, period: Double, phaseOffset: Double) {
        let w = size.width
        let h = size.height
        var path = Path()
        let y0 = h * baseY
        path.move(to: CGPoint(x: 0, y: h))
        path.addLine(to: CGPoint(x: 0, y: y0))
        let steps = 80
        for i in 0...steps {
            let x = w * Double(i) / Double(steps)
            let phase = Double(i) / Double(steps) * .pi * 4
            let dy = sin(phase + (time * (.pi * 2) / period) + phaseOffset) * amplitude
            path.addLine(to: CGPoint(x: x, y: y0 + dy))
        }
        path.addLine(to: CGPoint(x: w, y: h))
        path.closeSubpath()
        ctx.fill(path, with: .color(color))
    }

    private func bloomColor(_ hue: BloomHue) -> Color {
        switch hue {
        case .coral: Color.lbCoral2
        case .mint:  Color.lbMint
        case .mixed: Color.lbYellow
        }
    }
}

// MARK: - Route + walker

private struct RouteWithWalker: View {
    let from: VisitorPin
    let to: Sculpture

    var body: some View {
        GeometryReader { geo in
            let p1 = CGPoint(x: CGFloat(from.x) * geo.size.width, y: CGFloat(from.y) * geo.size.height)
            let p2 = CGPoint(x: CGFloat(to.x)   * geo.size.width, y: CGFloat(to.y)   * geo.size.height)
            // Arc the route up through the dune band (~y=0.18 of canvas) so it
            // doesn't cut through the pin row. The destination then dips down to
            // the target sculpture from above, making the goal unambiguous.
            let arcCeiling = geo.size.height * 0.18
            let mid = CGPoint(
                x: (p1.x + p2.x) / 2,
                y: min(arcCeiling, min(p1.y, p2.y) - 140)
            )

            ZStack {
                // Soft yellow glow under the route — reads as a "lit path"
                Path { p in p.move(to: p1); p.addQuadCurve(to: p2, control: mid) }
                    .stroke(Color.lbYellow.opacity(0.55), style: StrokeStyle(lineWidth: 14, lineCap: .round))
                    .blur(radius: 7)

                // Cream backing for high contrast on sand
                Path { p in p.move(to: p1); p.addQuadCurve(to: p2, control: mid) }
                    .stroke(Color.lbCream.opacity(0.92), style: StrokeStyle(lineWidth: 6, lineCap: .round))

                // Dashed navy route on top — denser dash for legibility
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
                    let t = ctx.date.timeIntervalSince1970
                    let phase = CGFloat((t * 18).truncatingRemainder(dividingBy: 12))
                    Path { p in p.move(to: p1); p.addQuadCurve(to: p2, control: mid) }
                        .stroke(
                            Color.lbNavy,
                            style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [4, 6], dashPhase: phase)
                        )
                }

                // Pulsing destination ring centered on target pin
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
                    let t = ctx.date.timeIntervalSince1970
                    let pulse = 1.0 + 0.18 * sin(t * 2.6)
                    ZStack {
                        Circle()
                            .stroke(Color.lbYellow.opacity(0.45), lineWidth: 2)
                            .frame(width: 76 * pulse, height: 76 * pulse)
                        Circle()
                            .stroke(Color.lbYellow, lineWidth: 3)
                            .frame(width: 56 * pulse, height: 56 * pulse)
                    }
                    .position(p2)
                }

                // Walking dot — bigger, with shadow for depth
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
                    let t = ctx.date.timeIntervalSince1970
                    let u = CGFloat((t * 0.18).truncatingRemainder(dividingBy: 1))
                    let x = (1 - u) * (1 - u) * p1.x + 2 * (1 - u) * u * mid.x + u * u * p2.x
                    let y = (1 - u) * (1 - u) * p1.y + 2 * (1 - u) * u * mid.y + u * u * p2.y
                    ZStack {
                        Circle().fill(Color.lbYellow.opacity(0.45)).frame(width: 30, height: 30)
                        Circle().fill(Color.lbYellow).frame(width: 16, height: 16)
                            .overlay(Circle().stroke(Color.lbNavy, lineWidth: 2.5))
                    }
                    .shadow(color: Color.lbNavy.opacity(0.30), radius: 4, x: 0, y: 2)
                    .position(x: x, y: y)
                }
            }
        }
    }
}

// MARK: - Sculpture detail sheet

private struct SculptureDetailSheet: View {
    let sculpture: Sculpture
    let walkMinutes: Int
    let onWalk: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // Real headshot from texassandfest.org, with a country-flag overlay.
                ZStack(alignment: .bottomLeading) {
                    AsyncImage(url: URL(string: sculpture.photoURL)) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().scaledToFill()
                        case .failure:
                            LinearGradient(colors: paletteForSculptor, startPoint: .topLeading, endPoint: .bottomTrailing)
                        case .empty:
                            ZStack {
                                LinearGradient(colors: paletteForSculptor, startPoint: .topLeading, endPoint: .bottomTrailing)
                                ProgressView().tint(Color.lbCream)
                            }
                        @unknown default:
                            LinearGradient(colors: paletteForSculptor, startPoint: .topLeading, endPoint: .bottomTrailing)
                        }
                    }
                    .frame(height: 240)
                    .frame(maxWidth: .infinity)
                    .clipped()

                    // Bottom gradient + flag chip for legibility
                    LinearGradient(
                        colors: [.clear, Color.lbNavy.opacity(0.55)],
                        startPoint: .top, endPoint: .bottom
                    )
                    .frame(height: 240)
                    .allowsHitTesting(false)

                    HStack(spacing: 8) {
                        Text(sculpture.country).font(.system(size: 22))
                        Text(sculpture.category.uppercased())
                            .font(.caption2.weight(.bold))
                            .tracking(1.6)
                            .foregroundStyle(Color.lbCream)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Color.lbNavy.opacity(0.7))
                            .clipShape(Capsule())
                    }
                    .padding(14)
                }
                .frame(height: 240)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                VStack(alignment: .leading, spacing: 6) {
                    Text("SCULPTURE #\(sculpture.id) · \(sculpture.crowd.label.uppercased()) CROWD")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.6)
                        .foregroundStyle(Color.lbNavy.opacity(0.62))
                    Text(sculpture.sculptor)
                        .font(.system(size: 32, design: .serif))
                        .foregroundStyle(Color.lbNavy)
                    Text(sculpture.title)
                        .font(.system(size: 18, design: .serif)).italic()
                        .foregroundStyle(Color.lbNavy.opacity(0.78))
                }

                HStack(spacing: 10) {
                    detailChip(icon: "figure.walk", text: "\(walkMinutes) min walk")
                    detailChip(icon: "music.note", text: "Audio · \(sculpture.audioMinutes)")
                    detailChip(icon: "play.rectangle", text: sculpture.timelapseHours)
                }

                Text(sculpture.bio)
                    .font(.callout)
                    .foregroundStyle(Color.lbNavy.opacity(0.86))
                    .fixedSize(horizontal: false, vertical: true)

                Button(action: onWalk) {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.up.forward")
                        Text("Walk me there")
                    }
                    .font(.headline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .foregroundStyle(Color.lbCream)
                    .background(Color.lbNavy)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)

                Text("Source: texassandfest.org · official 2026 lineup")
                    .font(.caption2)
                    .foregroundStyle(Color.lbNavy.opacity(0.45))
            }
            .padding(20)
        }
        .background(Color.lbCream.ignoresSafeArea())
    }

    private var paletteForSculptor: [Color] {
        switch sculpture.crowd {
        case .light:    [Color.lbMint, Color(red: 0.10, green: 0.40, blue: 0.42)]
        case .moderate: [Color.lbYellow, Color.lbCoral2]
        case .packed:   [Color.lbCoral2, Color.lbNavy]
        }
    }

    private func detailChip(icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption)
            Text(text).font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .foregroundStyle(Color.lbNavy)
        .background(Color.lbNavy.opacity(0.07))
        .clipShape(Capsule())
    }
}

// MARK: - Sculpture pin

private struct SculpturePinView: View {
    let sculpture: Sculpture
    let isSelected: Bool

    var body: some View {
        ZStack {
            Circle()
                .fill(Color.lbCream.opacity(0.85))
                .overlay(Circle().stroke(Color.lbNavy, lineWidth: 2))
                .frame(width: 36, height: 36)
            Circle()
                .fill(coreColor)
                .overlay(Circle().stroke(Color.lbNavy, lineWidth: 2))
                .frame(width: 24, height: 24)
            Text("\(sculpture.id)")
                .font(.caption.weight(.bold))
                .foregroundStyle(numberColor)
        }
        .scaleEffect(isSelected ? 1.15 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
    }

    private var coreColor: Color {
        switch sculpture.crowd {
        case .light:    Color.lbMint
        case .moderate: Color.lbYellow
        case .packed:   Color.lbCoral2
        }
    }

    private var numberColor: Color {
        sculpture.crowd == .packed ? Color.lbCream : Color.lbNavy
    }
}

private struct SculptureHoverCard: View {
    let sculpture: Sculpture
    let visitorDistance: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Sculpture #\(sculpture.id)")
                    .font(.caption2.weight(.semibold))
                    .tracking(1.4)
                    .foregroundStyle(Color.lbNavy.opacity(0.62))
                Text(sculpture.country)
                Spacer()
                Text(sculpture.crowd.label.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(crowdBg)
                    .foregroundStyle(crowdFg)
                    .clipShape(Capsule())
            }
            Text(sculpture.title).font(.system(size: 17, design: .serif)).italic()
                .foregroundStyle(Color.lbNavy)
            Text(sculpture.sculptor).font(.caption.weight(.medium)).foregroundStyle(Color.lbNavy.opacity(0.62))
            Text("\(visitorDistance) min walk from you")
                .font(.caption2.weight(.semibold))
                .tracking(0.4)
                .foregroundStyle(Color.lbNavy)
                .padding(.top, 2)
        }
        .padding(10)
        .frame(width: 200, alignment: .leading)
        .background(
            Color.lbCream.opacity(0.94)
                .background(.ultraThinMaterial)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.lbNavy.opacity(0.10), lineWidth: 1)
        )
        .shadow(color: Color.lbNavy.opacity(0.30), radius: 14, x: 0, y: 6)
        .allowsHitTesting(false)
    }

    private var crowdBg: Color {
        switch sculpture.crowd {
        case .light:    Color.lbMint.opacity(0.22)
        case .moderate: Color.lbYellow.opacity(0.28)
        case .packed:   Color.lbCoral2.opacity(0.25)
        }
    }
    private var crowdFg: Color {
        switch sculpture.crowd {
        case .light:    Color(red: 0.07, green: 0.34, blue: 0.29)
        case .moderate: Color(red: 0.42, green: 0.30, blue: 0.00)
        case .packed:   Color(red: 0.42, green: 0.17, blue: 0.07)
        }
    }
}

// MARK: - Route line

private struct RouteLine: Shape {
    let from: VisitorPin
    let to: Sculpture

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let p1 = CGPoint(x: CGFloat(from.x) * rect.width, y: CGFloat(from.y) * rect.height)
        let p2 = CGPoint(x: CGFloat(to.x) * rect.width,   y: CGFloat(to.y) * rect.height)
        let mid = CGPoint(
            x: (p1.x + p2.x) / 2,
            y: min(p1.y, p2.y) - 70
        )
        p.move(to: p1)
        p.addQuadCurve(to: p2, control: mid)
        return p
    }
}

#Preview {
    LiveBeachView()
        .environmentObject(AppDataStore())
}
