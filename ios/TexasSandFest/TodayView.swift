import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    AlertBanner(alert: dataStore.alert)
                    hero
                    quickActions
                    nextUp
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("SandFest Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    syncBadge
                }
            }
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
                Text("Offline guide, live alerts, AI concierge, volunteer check-in, and beach operations in one app.")
                    .foregroundStyle(.secondary)
                Text("Source: \(dataStore.source)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.sandFestGulf)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var quickActions: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            action("Ask Sandy", "sparkles")
            action("Tickets", "ticket")
            action("ADA Help", "figure.roll")
            action("Report Issue", "exclamationmark.bubble")
        }
    }

    private var nextUp: some View {
        Panel {
            VStack(alignment: .leading, spacing: 12) {
                Text("Next Up")
                    .font(.headline)
                ForEach(dataStore.payload.schedule.prefix(3)) { item in
                    HStack(alignment: .top) {
                        Text(item.time)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.sandFestCoral)
                            .frame(width: 72, alignment: .leading)
                        VStack(alignment: .leading) {
                            Text(item.title).font(.subheadline.weight(.semibold))
                            Text(item.zone).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func action(_ title: String, _ icon: String) -> some View {
        Button {
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.bold))
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
    }
}
