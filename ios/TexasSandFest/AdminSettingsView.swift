import SwiftUI

struct AdminSettingsView: View {
    var body: some View {
        NavigationStack {
            List {
                Section("Integrations") {
                    row("Eventeny", "Tickets, vendors, sponsors, volunteers", "Ready for exports")
                    row("QuickBooks", "Customers, vendors, invoices, payments", "Awaiting OAuth")
                    row("Port A Local Co", "Destination guide handoff", "Planned")
                }

                Section("Admin Roles") {
                    row("Guest Relations", "Policy, accessibility, lost and found", "Required")
                    row("Ops Command", "Incidents, zones, volunteers", "Required")
                    row("Finance", "QuickBooks, sponsor invoices, impact reporting", "Required")
                    row("Partner Manager", "Sponsors and vendors", "Required")
                }

                Section("Data Pipeline") {
                    row("Obsidian Vault", "Source review and canonical promotion", "Built")
                    row("Incoming Files", "Eventeny, docs, ops, finance, comms, QuickBooks", "Ready")
                }
            }
            .navigationTitle("Admin Setup")
        }
    }

    private func row(_ title: String, _ detail: String, _ status: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Text(status).font(.caption.weight(.bold)).foregroundStyle(Color.sandFestCoral)
            }
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
