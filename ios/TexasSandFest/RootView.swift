import SwiftUI

struct RootView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @State private var mode: AppMode = .customer
    @State private var customerRoute: CustomerRoute?
    @State private var publicRouteRequested: Bool

    init() {
        let route = CustomerRoute.launchRoute()
        _customerRoute = State(initialValue: route)
        _publicRouteRequested = State(initialValue: route != nil)
    }

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
                    CustomerRootView(route: $customerRoute)
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
        .onOpenURL(perform: openPublicRoute)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL else { return }
            openPublicRoute(url)
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
        if publicRouteRequested {
            mode = .customer
            return
        }
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

    private func openPublicRoute(_ url: URL) {
        guard let route = CustomerRoute(url: url) else { return }
        publicRouteRequested = true
        customerRoute = route
        mode = .customer
    }
}

struct CustomerRootView: View {
    @Binding var route: CustomerRoute?
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
    @State private var scheduleTargetItemID: String?
    @State private var beachSection: BeachSection = CommandLine.arguments.contains("sculptors")
        ? .sculptors
        : .live

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

            ScheduleView(targetItemID: $scheduleTargetItemID)
                .tabItem { Label("Schedule", systemImage: "calendar") }
                .tag(CustomerTab.schedule)

            BeachExperienceView(section: $beachSection)
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
        .onChange(of: route?.id, initial: true) { _, _ in
            consumeRoute()
        }
    }

    private func consumeRoute() {
        guard let destination = route?.destination else { return }
        route = nil
        switch destination {
        case .today:
            selectedTab = .today
        case let .schedule(itemID):
            scheduleTargetItemID = itemID
            selectedTab = .schedule
        case let .beach(section):
            beachSection = section
            selectedTab = .map
        case let .sandy(question):
            conciergeRequest = ConciergeRequest(
                question: question,
                submitImmediately: false
            )
            selectedTab = .concierge
        case .tickets:
            selectedTab = .tickets
        }
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
    @Binding var section: BeachSection

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

enum CustomerDestination: Equatable {
    case today
    case schedule(itemID: String?)
    case beach(section: BeachSection)
    case sandy(question: String?)
    case tickets
}

struct CustomerRoute: Identifiable {
    let id = UUID()
    let destination: CustomerDestination

    init?(url: URL) {
        guard let destination = Self.destination(for: url) else { return nil }
        self.destination = destination
    }

    static func launchRoute(arguments: [String] = CommandLine.arguments) -> CustomerRoute? {
        guard let index = arguments.firstIndex(of: "-deepLink"),
              index + 1 < arguments.count,
              let url = URL(string: arguments[index + 1]) else {
            return nil
        }
        return CustomerRoute(url: url)
    }

    private static func destination(for url: URL) -> CustomerDestination? {
        let scheme = url.scheme?.lowercased()
        let routeComponents: [String]

        switch scheme {
        case "sandfest":
            var components: [String] = []
            if let host = url.host, !host.isEmpty {
                components.append(host)
            }
            components.append(contentsOf: pathComponents(url))
            routeComponents = components
        case "https":
            guard url.host?.lowercased() == "sandfest.heyelab.com",
                  url.port == nil,
                  url.user == nil,
                  url.password == nil else {
                return nil
            }
            let components = pathComponents(url)
            if components.isEmpty, let fragment = url.fragment, !fragment.isEmpty {
                routeComponents = fragment.split(separator: "/").map(String.init)
            } else {
                routeComponents = components
            }
        default:
            return nil
        }

        guard let rawDestination = routeComponents.first?.lowercased() else {
            return .today
        }
        switch rawDestination {
        case "today", "home":
            return routeComponents.count == 1 ? .today : nil
        case "ticket", "tickets":
            return routeComponents.count == 1 ? .tickets : nil
        case "schedule":
            guard routeComponents.count <= 2 else { return nil }
            let itemID = routeComponents.count == 2 ? routeComponents[1] : nil
            if let itemID, !validScheduleItemID(itemID) { return nil }
            return .schedule(itemID: itemID)
        case "beach", "live-beach", "map", "island-conditions":
            return routeComponents.count == 1 ? .beach(section: .live) : nil
        case "sculptors":
            return routeComponents.count == 1 ? .beach(section: .sculptors) : nil
        case "sandy", "ask-sandy", "concierge":
            guard routeComponents.count == 1 else { return nil }
            return .sandy(question: boundedQuestion(from: url))
        default:
            return nil
        }
    }

    private static func pathComponents(_ url: URL) -> [String] {
        url.pathComponents
            .filter { $0 != "/" && !$0.isEmpty }
            .compactMap { $0.removingPercentEncoding }
    }

    private static func validScheduleItemID(_ value: String) -> Bool {
        guard (1...100).contains(value.count) else { return false }
        return value.range(
            of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#,
            options: .regularExpression
        ) != nil
    }

    private static func boundedQuestion(from url: URL) -> String? {
        let rawQuestion = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name.lowercased() == "question" })?
            .value?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let rawQuestion,
              (2...280).contains(rawQuestion.count),
              rawQuestion.rangeOfCharacter(from: .controlCharacters) == nil else {
            return nil
        }
        return rawQuestion
    }
}

enum AdminTab {
    case command
    case fleet
    case incidents
    case partners
    case finance
    case setup
}
