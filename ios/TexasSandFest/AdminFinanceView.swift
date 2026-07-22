import SwiftUI

struct AdminFinanceView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Panel {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Finance")
                                .font(.largeTitle.weight(.bold))
                                .foregroundStyle(Color.sandFestDeep)
                            Text("Receivables, budget, revenue reconciliation, and accounting readiness from the current operations snapshot.")
                                .foregroundStyle(.secondary)
                            Label(dataStore.adminSource, systemImage: dataStore.adminSyncState == .live ? "checkmark.circle.fill" : "externaldrive")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(dataStore.adminSyncState == .live ? Color.sandFestGulf : .secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    ForEach(dataStore.payload.financeSignals) { signal in
                        Panel {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(signal.label)
                                        .font(.headline)
                                    Text(signal.detail)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(signal.value)
                                    .font(.caption.weight(.bold))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                                    .background(Color.sandFestGulf.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Finance")
        }
    }
}
