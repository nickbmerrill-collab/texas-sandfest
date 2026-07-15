import SwiftUI

@main
struct TexasSandFestApp: App {
    @StateObject private var dataStore = AppDataStore()
    @StateObject private var passport = PassportStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(dataStore)
                .environmentObject(passport)
        }
    }
}
