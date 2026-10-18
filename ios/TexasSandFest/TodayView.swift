import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let onAskSandy: (_ question: String?, _ submitImmediately: Bool) -> Void
    let onShowTickets: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Spacer()
                        syncBadge
                    }
                    AlertBanner(alert: dataStore.alert)
                    hero
                    quickActions
                    nextUp
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("SandFest Today")
            .navigationBarTitleDisplayMode(dynamicTypeSize.isAccessibilitySize ? .inline : .large)
            .refreshable {
                await dataStore.refreshPublicData()
            }
        }
    }

    private var hero: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text(dataStore.payload.guide.dateRange)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color.sandFestCoral)
                    .textCase(.uppercase)
                Text(dataStore.payload.guide.name)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Color.sandFestDeep)
                Text("Event essentials, alerts, Ask Sandy, tickets, and beach guidance in one app.")
                    .foregroundStyle(Color.sandFestSecondary)
                Text(dataStore.source == "Bundled seed" ? "Saved event guide" : "Source: \(dataStore.source)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.sandFestGulf)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var quickActions: some View {
        LazyVGrid(columns: quickActionColumns, spacing: 12) {
            action("Ask Sandy", "sparkles") {
                onAskSandy(nil, false)
            }
            action("Tickets", "ticket") {
                onShowTickets()
            }
            action("ADA Help", "figure.roll") {
                onAskSandy("What accessibility services are available?", true)
            }
            action("Safety Help", "cross.case.fill") {
                onAskSandy("I need security for an emergency or safety issue.", true)
            }
        }
    }

    private var quickActionColumns: [GridItem] {
        if dynamicTypeSize.isAccessibilitySize {
            return [GridItem(.flexible())]
        }
        return [GridItem(.flexible()), GridItem(.flexible())]
    }

    private var nextUp: some View {
        Panel {
            VStack(alignment: .leading, spacing: 12) {
                Text("Next Up")
                    .font(.headline)
                if dataStore.payload.schedule.isEmpty {
                    Text("The detailed 2027 daily schedule has not been published yet.")
                        .font(.subheadline)
                        .foregroundStyle(Color.sandFestSecondary)
                } else {
                    ForEach(dataStore.payload.schedule.prefix(3)) { item in
                        HStack(alignment: .top) {
                            Text(item.time)
                                .font(.caption.weight(.bold))
                                .foregroundStyle(Color.sandFestCoral)
                                .frame(width: 72, alignment: .leading)
                            VStack(alignment: .leading) {
                                Text(item.title).font(.subheadline.weight(.semibold))
                                Text(item.zone).font(.caption).foregroundStyle(Color.sandFestSecondary)
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func action(_ title: String, _ icon: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.bold))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.borderedProminent)
        .tint(.sandFestGulf)
    }

    private var syncBadge: some View {
        Text(dataStore.syncState.label)
            .font(.caption.weight(.bold))
            .foregroundStyle(dataStore.syncState == .offline ? Color.sandFestCoral : Color.sandFestGulf)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.white.opacity(0.9))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .accessibilityLabel(dataStore.syncState.label)
            .accessibilityHint("Event guide status")
    }
}
