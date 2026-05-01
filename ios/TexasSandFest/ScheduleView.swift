import SwiftUI

struct ScheduleView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            List(dataStore.payload.schedule) { item in
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(item.day) \(item.time)")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.sandFestCoral)
                    Text(item.title)
                        .font(.headline)
                    Text("\(item.zone) · \(item.category)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)
            }
            .navigationTitle("Schedule")
        }
    }
}
