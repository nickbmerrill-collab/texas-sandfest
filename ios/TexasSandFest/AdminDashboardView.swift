import SwiftUI

struct AdminDashboardView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    alertStatus
                    coverageGrid
                    zoneStatus
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Command")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await dataStore.refreshPublicData() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
        }
    }

    private var header: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                Text("Admin Command")
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Color.sandFestDeep)
                Text("Staff-only view for crowd status, volunteer coverage, incidents, partner readiness, and finance signals.")
                    .foregroundStyle(.secondary)
                HStack {
                    statusPill("Public guide", dataStore.syncState.label)
                    statusPill("Operations", dataStore.adminSyncState.label)
                    statusPill("Open work", String(dataStore.adminTaskSummary?.active ?? 0))
                }
                Label(dataStore.adminSource, systemImage: dataStore.adminSyncState == .live ? "checkmark.circle.fill" : "externaldrive")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(dataStore.adminSyncState == .live ? Color.sandFestGulf : .secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var alertStatus: some View {
        Panel {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Public Alert")
                        .font(.headline)
                    Spacer()
                    Text(dataStore.alert.isVisible ? dataStore.alert.severity.label : "Clear")
                        .font(.caption.weight(.black))
                        .foregroundStyle(dataStore.alert.isVisible ? Color.sandFestCoral : Color.sandFestGulf)
                }
                if dataStore.alert.isVisible {
                    AlertBanner(alert: dataStore.alert)
                } else {
                    Text("No active public alert. The iOS app will keep the bundled guide available if the API is unreachable.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var coverageGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(dataStore.payload.coverage) { coverage in
                Panel {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(coverage.zone)
                            .font(.headline)
                        Text("\(coverage.filled)/\(coverage.needed)")
                            .font(.title.weight(.bold))
                            .foregroundStyle(coverage.filled >= coverage.needed ? Color.green : Color.sandFestCoral)
                        Text("volunteer coverage")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var zoneStatus: some View {
        Panel {
            VStack(alignment: .leading, spacing: 12) {
                Text("Zone Status")
                    .font(.headline)
                ForEach(dataStore.payload.zones) { zone in
                    HStack {
                        Circle()
                            .fill(color(for: zone.status))
                            .frame(width: 10, height: 10)
                        VStack(alignment: .leading) {
                            Text(zone.name).font(.subheadline.weight(.semibold))
                            Text(zone.summary).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(zone.marker)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Color.sandFestCoral)
                    }
                }
            }
        }
    }

    private func statusPill(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.caption.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .padding(10)
        .background(Color.sandFestGulf.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func color(for status: ZoneStatus) -> Color {
        switch status {
        case .normal: .green
        case .busy: .sandFestSun
        case .attention: .sandFestCoral
        }
    }
}
