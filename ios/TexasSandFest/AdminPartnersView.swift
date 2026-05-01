import SwiftUI

struct AdminPartnersView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            List {
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
        }
    }
}
