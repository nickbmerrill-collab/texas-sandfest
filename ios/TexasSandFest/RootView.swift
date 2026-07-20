import SwiftUI

struct RootView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @State private var mode: AppMode = .customer

    var body: some View {
        VStack(spacing: 0) {
            if dataStore.staffAccessMode.allowsAdmin {
                modePicker
            }
            if mode == .admin && dataStore.staffAccessMode == .boardDemo {
                boardDemoBanner
            }

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
        .task {
            await dataStore.refreshPublicData()
            applyStaffAccess(dataStore.staffAccessMode)
        }
        .onChange(of: dataStore.staffAccessMode) { _, accessMode in
            applyStaffAccess(accessMode)
        }
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

    private var boardDemoBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "testtube.2")
            VStack(alignment: .leading, spacing: 2) {
                Text("Synthetic board demo")
                    .font(.caption.weight(.bold))
                Text("No external messages, charges, or live-provider calls")
                    .font(.caption2)
            }
            Spacer()
        }
        .foregroundStyle(Color.sandFestDeep)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color.sandFestSun.opacity(0.32))
    }

    private func applyStaffAccess(_ accessMode: StaffAccessMode) {
        guard accessMode.allowsAdmin else {
            mode = .customer
            return
        }
        if requestedAdminDemo {
            mode = .admin
        }
    }

    private var requestedAdminDemo: Bool {
        let arguments = CommandLine.arguments
        guard let index = arguments.firstIndex(of: "-startMode"), index + 1 < arguments.count else {
            return false
        }
        return arguments[index + 1].lowercased() == "admin"
    }
}

struct CustomerRootView: View {
    @State private var selectedTab: CustomerTab = {
        // Default to the Beach tab if launched with -startTab beach (handy for demos / screenshots).
        if CommandLine.arguments.contains("-conciergePrompt") {
            return .concierge
        }
        if CommandLine.arguments.contains(where: { $0 == "-startTab" }),
           let idx = CommandLine.arguments.firstIndex(of: "-startTab"),
           idx + 1 < CommandLine.arguments.count {
            switch CommandLine.arguments[idx + 1] {
            case "beach": return .map
            case "sculptors": return .map
            case "sandy": return .concierge
            case "tickets": return .tickets
            case "schedule": return .schedule
            default: return .today
            }
        }
        return .today
    }()
    @State private var conciergeRequest: ConciergeRequest? = {
        let arguments = CommandLine.arguments
        guard let index = arguments.firstIndex(of: "-conciergePrompt"),
              index + 1 < arguments.count else {
            return nil
        }
        return ConciergeRequest(question: arguments[index + 1], submitImmediately: true)
    }()

    var body: some View {
        TabView(selection: $selectedTab) {
            TodayView(
                onAskSandy: { question, submitImmediately in
                    conciergeRequest = ConciergeRequest(
                        question: question,
                        submitImmediately: submitImmediately
                    )
                    selectedTab = .concierge
                },
                onShowTickets: {
                    selectedTab = .tickets
                }
            )
                .tabItem { Label("Today", systemImage: "sun.max") }
                .tag(CustomerTab.today)

            ScheduleView()
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(CustomerTab.schedule)

            BeachExperienceView()
                .tabItem { Label("Beach", systemImage: "sparkles.tv") }
                .tag(CustomerTab.map)

            ConciergeView(request: $conciergeRequest) { href in
                openConciergeSource(href)
            }
                .tabItem { Label("Sandy", systemImage: "sparkles") }
                .tag(CustomerTab.concierge)

            TicketsView()
                .tabItem { Label("Tickets", systemImage: "ticket") }
                .tag(CustomerTab.tickets)
        }
        .tint(.sandFestGulf)
    }

    private func openConciergeSource(_ href: String) {
        switch href {
        case "#tickets":
            selectedTab = .tickets
        case "#schedule":
            selectedTab = .schedule
        case "#operations", "#island-conditions", "#map":
            selectedTab = .map
        default:
            selectedTab = .today
        }
    }
}

struct BeachExperienceView: View {
    @State private var section: BeachSection = CommandLine.arguments.contains("sculptors")
        ? .sculptors
        : .live

    var body: some View {
        VStack(spacing: 0) {
            Picker("Beach View", selection: $section) {
                ForEach(BeachSection.allCases) { section in
                    Label(section.title, systemImage: section.icon).tag(section)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.bar)

            switch section {
            case .live:
                LiveBeachView()
            case .sculptors:
                SculptorsView()
            }
        }
    }
}

enum BeachSection: String, CaseIterable, Identifiable {
    case live
    case sculptors

    var id: String { rawValue }

    var title: String {
        switch self {
        case .live: "Live Beach"
        case .sculptors: "Sculptors"
        }
    }

    var icon: String {
        switch self {
        case .live: "wave.3.right"
        case .sculptors: "photo.artframe"
        }
    }
}

struct ConciergeRequest: Identifiable, Equatable {
    let id = UUID()
    let question: String?
    let submitImmediately: Bool
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
