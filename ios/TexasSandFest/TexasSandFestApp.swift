import SwiftUI

@main
struct TexasSandFestApp: App {
    @StateObject private var dataStore = AppDataStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(dataStore)
        }
    }
}
