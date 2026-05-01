import SwiftUI

extension Color {
    static let sandFestSand = Color(red: 0.96, green: 0.86, blue: 0.64)
    static let sandFestSun = Color(red: 0.96, green: 0.68, blue: 0.18)
    static let sandFestCoral = Color(red: 0.88, green: 0.32, blue: 0.25)
    static let sandFestGulf = Color(red: 0.0, green: 0.42, blue: 0.46)
    static let sandFestDeep = Color(red: 0.07, green: 0.2, blue: 0.23)
    static let sandFestFoam = Color(red: 0.98, green: 0.96, blue: 0.91)

    // Live Beach palette (mirrors web tokens)
    static let lbCream  = Color(red: 1.00, green: 0.965, blue: 0.902)
    static let lbNavy   = Color(red: 0.055, green: 0.165, blue: 0.278)
    static let lbYellow = Color(red: 0.965, green: 0.839, blue: 0.435)
    static let lbMint   = Color(red: 0.490, green: 0.827, blue: 0.753)
    static let lbCoral2 = Color(red: 0.941, green: 0.541, blue: 0.365)
    static let lbDune   = Color(red: 0.941, green: 0.851, blue: 0.639)
    static let lbSand   = Color(red: 1.00, green: 0.945, blue: 0.827)
}

struct Panel<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .background(Color.white.opacity(0.92))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .shadow(color: .sandFestDeep.opacity(0.08), radius: 18, x: 0, y: 8)
    }
}

struct AlertBanner: View {
    let alert: EmergencyAlert

    var body: some View {
        if alert.isVisible {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: iconName)
                    .font(.title3.weight(.bold))
                VStack(alignment: .leading, spacing: 5) {
                    Text(alert.severity.label)
                        .font(.caption.weight(.black))
                        .textCase(.uppercase)
                    Text(alert.title)
                        .font(.headline)
                    Text(alert.message)
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(foregroundColor)
            .padding(14)
            .background(backgroundColor)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var iconName: String {
        switch alert.severity {
        case .critical: "exclamationmark.triangle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .watch: "eye.fill"
        case .info, .clear: "info.circle.fill"
        }
    }

    private var backgroundColor: Color {
        switch alert.severity {
        case .critical: .sandFestCoral.opacity(0.18)
        case .warning: .sandFestSun.opacity(0.28)
        case .watch: .sandFestGulf.opacity(0.15)
        case .info, .clear: .white.opacity(0.92)
        }
    }

    private var foregroundColor: Color {
        switch alert.severity {
        case .critical, .warning: .sandFestDeep
        case .watch: .sandFestGulf
        case .info, .clear: .sandFestDeep
        }
    }
}
