import SwiftUI

struct RootView: View {
    @State private var mode: AppMode = .customer

    var body: some View {
        VStack(spacing: 0) {
            modePicker

            Group {
                switch mode {
                case .customer:
                    CustomerRootView()
                case .admin:
                    AdminRootView()
                }
            }
        }
        .background(Color.sandFestFoam.ignoresSafeArea())
    }

    private var modePicker: some View {
        Picker("App Mode", selection: $mode) {
            ForEach(AppMode.allCases) { mode in
                Text(mode.title).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

struct CustomerRootView: View {
    @State private var selectedTab: CustomerTab = {
        // Default to the Beach tab if launched with -startTab beach (handy for demos / screenshots).
        if CommandLine.arguments.contains(where: { $0 == "-startTab" }),
           let idx = CommandLine.arguments.firstIndex(of: "-startTab"),
           idx + 1 < CommandLine.arguments.count {
            switch CommandLine.arguments[idx + 1] {
            case "beach": return .map
            case "sandy": return .concierge
            case "tickets": return .tickets
            case "schedule": return .schedule
            default: return .today
            }
        }
        return .today
    }()

    var body: some View {
        TabView(selection: $selectedTab) {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(CustomerTab.today)

            ScheduleView()
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(CustomerTab.schedule)

            LiveBeachView()
                .tabItem { Label("Beach", systemImage: "sparkles.tv") }
                .tag(CustomerTab.map)

            SculptorsView()
                .tabItem { Label("Sculptors", systemImage: "photo.artframe") }
                .tag(CustomerTab.sculptors)

            ConciergeView()
                .tabItem { Label("Sandy", systemImage: "sparkles") }
                .tag(CustomerTab.concierge)

            TicketsView()
                .tabItem { Label("Tickets", systemImage: "ticket") }
                .tag(CustomerTab.tickets)
        }
        .tint(.sandFestGulf)
    }
}

struct AdminRootView: View {
    @State private var selectedTab: AdminTab = .command

    var body: some View {
        TabView(selection: $selectedTab) {
            AdminDashboardView()
                .tabItem { Label("Command", systemImage: "rectangle.3.group") }
                .tag(AdminTab.command)

            FleetView()
                .tabItem { Label("Fleet", systemImage: "car.side") }
                .tag(AdminTab.fleet)

            OpsView()
                .tabItem { Label("Incidents", systemImage: "radio") }
                .tag(AdminTab.incidents)

            AdminPartnersView()
                .tabItem { Label("Partners", systemImage: "person.3") }
                .tag(AdminTab.partners)

            AdminFinanceView()
                .tabItem { Label("Finance", systemImage: "dollarsign.circle") }
                .tag(AdminTab.finance)

            AdminSettingsView()
                .tabItem { Label("Setup", systemImage: "gearshape") }
                .tag(AdminTab.setup)
        }
        .tint(.sandFestGulf)
    }
}

enum AppMode: String, CaseIterable, Identifiable {
    case customer
    case admin

    var id: String { rawValue }

    var title: String {
        switch self {
        case .customer: "Customer"
        case .admin: "Admin"
        }
    }
}

enum CustomerTab {
    case today
    case schedule
    case map
    case sculptors
    case concierge
    case tickets
}

enum AdminTab {
    case command
    case fleet
    case incidents
    case partners
    case finance
    case setup
}
