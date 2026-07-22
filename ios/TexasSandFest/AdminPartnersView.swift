import SwiftUI

struct AdminPartnersView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label(dataStore.adminSource, systemImage: dataStore.adminSyncState == .live ? "checkmark.circle.fill" : "externaldrive")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(dataStore.adminSyncState == .live ? Color.sandFestGulf : .secondary)
                }

                Section("Delegated Work") {
                    NavigationLink {
                        NativeTaskBoardView()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "checklist")
                                .font(.title2)
                                .foregroundStyle(Color.sandFestGulf)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Staff and Volunteer Work Board")
                                    .font(.headline)
                                if let summary = dataStore.adminTaskSummary {
                                    Text("\(summary.active) active · \(summary.overdue) overdue · \(summary.blocked) blocked")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("Volunteer Operations") {
                    NavigationLink {
                        VolunteerAttendanceView()
                    } label: {
                        Label("Shift Attendance", systemImage: "person.crop.circle.badge.checkmark")
                            .font(.headline)
                            .foregroundStyle(Color.sandFestDeep)
                            .padding(.vertical, 4)
                    }
                }

                Section("Sponsors") {
                    ForEach(dataStore.payload.sponsors) { sponsor in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(sponsor.name).font(.headline)
                                Spacer()
                                Text(sponsor.tier).font(.caption.weight(.bold)).foregroundStyle(Color.sandFestCoral)
                            }
                            Text("Invoice: \(sponsor.invoiceStatus)")
                                .font(.subheadline)
                            Text("Fulfillment: \(sponsor.fulfillmentStatus)")
                                .font(.subheadline)
                            Text("Next: \(sponsor.nextAction)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 6)
                    }
                }

                Section("Vendors") {
                    ForEach(dataStore.payload.vendors) { vendor in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(vendor.name).font(.headline)
                                Spacer()
                                Text(vendor.booth).font(.caption.weight(.bold))
                            }
                            Text("\(vendor.category) · \(vendor.status)")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            .navigationTitle("Partners")
            .refreshable {
                await dataStore.refreshPublicData()
            }
        }
    }
}
