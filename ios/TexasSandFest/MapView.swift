import SwiftUI

struct MapView: View {
    @EnvironmentObject private var dataStore: AppDataStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(dataStore.payload.zones) { zone in
                        Panel {
                            HStack(alignment: .top, spacing: 12) {
                                statusDot(zone.status)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(zone.name)
                                        .font(.headline)
                                    Text("Marker \(zone.marker)")
                                        .font(.caption.weight(.bold))
                                        .foregroundStyle(Color.sandFestCoral)
                                    Text(zone.summary)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                        }
                    }
                }
                .padding()
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Beach Map")
        }
    }

    private func statusDot(_ status: ZoneStatus) -> some View {
        let color: Color = switch status {
        case .normal: .green
        case .busy: .sandFestSun
        case .attention: .sandFestCoral
        }

        return Circle()
            .fill(color)
            .frame(width: 12, height: 12)
            .padding(.top, 4)
    }
}
