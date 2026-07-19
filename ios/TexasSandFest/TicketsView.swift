import SwiftUI

struct TicketsView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @StateObject private var userTickets = UserTicketsStore()
    @State private var pulseGlow = false
    @State private var scannerVisible = false
    @State private var importToast: String? = nil

    private var seedTickets: [Ticket] {
        dataStore.payload.myTickets ?? SampleData.myTickets
    }

    /// Imported (user-scanned) tickets first, then bundled seed tickets. De-duped by id.
    private var tickets: [Ticket] {
        var seen = Set<String>()
        var out: [Ticket] = []
        for t in userTickets.imported + seedTickets where !seen.contains(t.id) {
            seen.insert(t.id)
            out.append(t)
        }
        return out
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    if tickets.isEmpty {
                        emptyState
                    } else {
                        VStack(spacing: 18) {
                            ForEach(tickets) { ticket in
                                WristbandTicketCard(ticket: ticket, eventGuide: dataStore.payload.guide, glow: pulseGlow)
                            }
                        }
                    }

                    sponsorPackages
                    finePrint
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
                .padding(.top, 4)
            }
            .background(Color.lbCream.ignoresSafeArea())
            .navigationTitle("Tickets")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        scannerVisible = true
                    } label: {
                        Label("Add", systemImage: "qrcode.viewfinder")
                    }
                }
            }
            .sheet(isPresented: $scannerVisible) {
                NavigationStack {
                    QRScannerView { payload in
                        let ticket = userTickets.importFromQR(payload, eventGuide: dataStore.payload.guide)
                        importToast = "Added \(ticket.band.rawValue) wristband"
                        scannerVisible = false
                        Task {
                            try? await Task.sleep(nanoseconds: 3_000_000_000)
                            importToast = nil
                        }
                    }
                    .navigationTitle("Scan ticket QR")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Cancel") { scannerVisible = false }
                        }
                    }
                }
                .presentationDetents([.large])
            }
            .overlay(alignment: .bottom) {
                if let toast = importToast {
                    Text(toast)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.lbCream)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Color.lbNavy)
                        .clipShape(Capsule())
                        .padding(.bottom, 100)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .onAppear {
                withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                    pulseGlow = true
                }
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("YOUR WRISTBANDS")
                .font(.caption.weight(.semibold))
                .tracking(1.6)
                .foregroundStyle(Color.lbNavy.opacity(0.62))
            Text("Hand to the gate.")
                .font(.system(size: 30, design: .serif))
                .foregroundStyle(Color.lbNavy)
            Text("Tap a wristband to brighten the QR for scanning. Tickets work offline once loaded — phone signal is unreliable on the beach.")
                .font(.subheadline)
                .foregroundStyle(Color.lbNavy.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "ticket")
                .font(.system(size: 40))
                .foregroundStyle(Color.lbNavy.opacity(0.4))
            Text("No wristbands loaded yet").font(.headline).foregroundStyle(Color.lbNavy)
            Text("Buy through Eventeny and your wristband will sync here.")
                .font(.subheadline)
                .foregroundStyle(Color.lbNavy.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(Color.white.opacity(0.78))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var sponsorPackages: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("NEED MORE?")
                .font(.caption.weight(.semibold))
                .tracking(1.6)
                .foregroundStyle(Color.lbNavy.opacity(0.62))

            ForEach(dataStore.payload.ticketOptions) { option in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "ticket.fill")
                        .foregroundStyle(Color.lbYellow)
                        .padding(10)
                        .background(Color.lbNavy)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(option.name).font(.headline).foregroundStyle(Color.lbNavy)
                        Text(option.detail)
                            .font(.caption)
                            .foregroundStyle(Color.lbNavy.opacity(0.62))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.lbNavy.opacity(0.5))
                }
                .padding(14)
                .background(Color.white.opacity(0.78))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.lbNavy.opacity(0.08), lineWidth: 1)
                )
            }
        }
    }

    private var finePrint: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("FINE PRINT").font(.caption2.weight(.semibold)).tracking(1.6).foregroundStyle(Color.lbNavy.opacity(0.5))
            Text("Wristbands are non-transferable once activated at the gate. Lost or stolen wristbands can be reissued at North Gate Guest Relations with photo ID. Re-entry permitted; bag check on every entry. No outside alcohol.")
                .font(.caption)
                .foregroundStyle(Color.lbNavy.opacity(0.6))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 8)
    }
}

// MARK: - Wristband ticket card

private struct WristbandTicketCard: View {
    let ticket: Ticket
    let eventGuide: EventGuide
    let glow: Bool

    @State private var qrLargePulse = false

    private var bandColor: Color { Color(hex: ticket.band.swatchHex) ?? Color.lbYellow }

    var body: some View {
        VStack(spacing: 0) {
            bandHeader
            ticketBody
        }
        .background(Color.white)
        .clipShape(TicketShape())
        .overlay(TicketShape().stroke(Color.lbNavy.opacity(0.10), lineWidth: 1))
        .shadow(color: Color.lbNavy.opacity(0.18), radius: 22, x: 0, y: 12)
    }

    private var bandHeader: some View {
        ZStack(alignment: .leading) {
            bandColor

            // Subtle stripes for the wristband look
            HStack(spacing: 0) {
                ForEach(0..<48, id: \.self) { i in
                    Rectangle()
                        .fill(i % 2 == 0 ? Color.white.opacity(0.06) : Color.clear)
                        .frame(width: 8)
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text("TEXAS SANDFEST \(LiveTimeline.eventYear(for: eventGuide))")
                        .font(.caption.weight(.bold))
                        .tracking(2)
                        .foregroundStyle(textOnBand.opacity(0.85))
                    Spacer(minLength: 0)
                    statusPill
                }
                Text(ticket.band.rawValue)
                    .font(.system(size: 24, weight: .bold, design: .serif))
                    .foregroundStyle(textOnBand)
                Text(ticket.dayPass)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(textOnBand.opacity(0.85))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
        }
        .frame(maxWidth: .infinity)
    }

    private var ticketBody: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                LabeledRow(label: "HOLDER", value: ticket.holder)
                if let seat = ticket.seat {
                    LabeledRow(label: "ZONE", value: seat)
                }
                LabeledRow(label: "SOURCE", value: ticket.purchaseSource)
                LabeledRow(label: "WRISTBAND ID", value: shortId, valueFont: .system(size: 13, weight: .medium, design: .monospaced))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            qrColumn
        }
        .padding(18)
    }

    private var qrColumn: some View {
        VStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.lbCream)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(bandColor.opacity(0.4), lineWidth: 2)
                    )
                if let img = QRCodeGenerator.image(from: ticket.id) {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(8)
                } else {
                    Text("QR")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(Color.lbNavy)
                }
            }
            .frame(width: 130, height: 130)
            .shadow(color: bandColor.opacity(glow ? 0.55 : 0.20), radius: glow ? 14 : 6)

            Text("Hold up to scanner")
                .font(.caption2.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(Color.lbNavy.opacity(0.55))
        }
    }

    private var statusPill: some View {
        Text(ticket.entryStatus.label.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(1.2)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(textOnBand.opacity(0.18))
            .foregroundStyle(textOnBand)
            .clipShape(Capsule())
    }

    private var textOnBand: Color {
        // Pick navy or cream based on band swatch luminance.
        bandColor.luminance > 0.6 ? Color.lbNavy : Color.lbCream
    }

    private var shortId: String {
        // Strip the "tsf:t:" prefix and chunk for readability.
        ticket.id
            .replacingOccurrences(of: "tsf:t:", with: "")
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String
    var valueFont: Font = .system(size: 14, weight: .medium)

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2.weight(.semibold))
                .tracking(1.4)
                .foregroundStyle(Color.lbNavy.opacity(0.55))
            Text(value).font(valueFont).foregroundStyle(Color.lbNavy)
        }
    }
}

/// Ticket shape with perforations near the bottom — gives it the "torn stub" feel.
private struct TicketShape: Shape {
    func path(in rect: CGRect) -> Path {
        let r: CGFloat = 18
        let notchY = rect.height - 70
        let notchR: CGFloat = 9

        var p = Path()
        p.move(to: CGPoint(x: r, y: 0))
        p.addLine(to: CGPoint(x: rect.width - r, y: 0))
        p.addQuadCurve(to: CGPoint(x: rect.width, y: r), control: CGPoint(x: rect.width, y: 0))
        p.addLine(to: CGPoint(x: rect.width, y: notchY - notchR))
        p.addArc(center: CGPoint(x: rect.width, y: notchY), radius: notchR, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: true)
        p.addLine(to: CGPoint(x: rect.width, y: rect.height - r))
        p.addQuadCurve(to: CGPoint(x: rect.width - r, y: rect.height), control: CGPoint(x: rect.width, y: rect.height))
        p.addLine(to: CGPoint(x: r, y: rect.height))
        p.addQuadCurve(to: CGPoint(x: 0, y: rect.height - r), control: CGPoint(x: 0, y: rect.height))
        p.addLine(to: CGPoint(x: 0, y: notchY + notchR))
        p.addArc(center: CGPoint(x: 0, y: notchY), radius: notchR, startAngle: .degrees(90), endAngle: .degrees(-90), clockwise: true)
        p.addLine(to: CGPoint(x: 0, y: r))
        p.addQuadCurve(to: CGPoint(x: r, y: 0), control: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        return p
    }
}

// MARK: - Color helpers

extension Color {
    init?(hex: String) {
        var h = hex
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        let r = Double((v >> 16) & 0xFF) / 255.0
        let g = Double((v >> 8) & 0xFF) / 255.0
        let b = Double(v & 0xFF) / 255.0
        self = Color(red: r, green: g, blue: b)
    }

    /// Rough perceptual luminance in 0..1. Used to pick text color over a swatch.
    var luminance: Double {
        let cgColor = UIColor(self).cgColor
        let comps = cgColor.components ?? [0, 0, 0, 1]
        let r = Double(comps.indices.contains(0) ? comps[0] : 0)
        let g = Double(comps.indices.contains(1) ? comps[1] : 0)
        let b = Double(comps.indices.contains(2) ? comps[2] : 0)
        return 0.299 * r + 0.587 * g + 0.114 * b
    }
}
