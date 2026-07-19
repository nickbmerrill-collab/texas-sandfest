import Foundation

struct EventGuide: Identifiable, Codable {
    let id: String
    let name: String
    let startDate: String?
    let endDate: String?
    let dateRange: String
    let timeZone: String?
    let location: String
    let lastUpdated: Date

    init(
        id: String,
        name: String,
        startDate: String? = nil,
        endDate: String? = nil,
        dateRange: String,
        timeZone: String? = nil,
        location: String,
        lastUpdated: Date
    ) {
        self.id = id
        self.name = name
        self.startDate = startDate
        self.endDate = endDate
        self.dateRange = dateRange
        self.timeZone = timeZone
        self.location = location
        self.lastUpdated = lastUpdated
    }
}

struct EmergencyAlert: Identifiable, Codable {
    let id: String
    var active: Bool
    var severity: AlertSeverity
    var title: String
    var message: String
    var audience: [String]
    var updatedAt: Date
    var expiresAt: Date?

    var isVisible: Bool {
        guard active else { return false }
        guard let expiresAt else { return true }
        return expiresAt > Date()
    }

    static let inactive = EmergencyAlert(
        id: "alert_none",
        active: false,
        severity: .info,
        title: "",
        message: "",
        audience: ["public"],
        updatedAt: Date(),
        expiresAt: nil
    )
}

enum AlertSeverity: String, Codable {
    case info
    case watch
    case warning
    case critical
    case clear

    var label: String {
        switch self {
        case .info: "Info"
        case .watch: "Watch"
        case .warning: "Warning"
        case .critical: "Critical"
        case .clear: "Clear"
        }
    }
}

struct ScheduleItem: Identifiable, Codable {
    let id: String
    let day: String
    let time: String
    let title: String
    let zone: String
    let category: String
    // ACL-style fields. Optional for backward compatibility with legacy seed JSON.
    let stage: String?
    let artist: String?
    let endTime: String?
    let durationMinutes: Int?
}

// MARK: - Tickets

enum TicketEntryStatus: String, Codable {
    case unused          // never scanned in
    case checkedIn       // currently inside the venue
    case usedToday       // already scanned in today

    var label: String {
        switch self {
        case .unused:     "Ready to scan"
        case .checkedIn:  "Checked in"
        case .usedToday:  "Used today"
        }
    }
}

enum TicketBand: String, Codable {
    case threeDayGA   = "3-Day GA"
    case threeDayVIP  = "3-Day VIP"
    case singleDay    = "Single-Day GA"
    case sponsor      = "Sponsor Pass"
    case staff        = "Staff Wristband"
    case raffle       = "Raffle Ticket"

    /// Hex strings rendered to Color in TicketsView so a JSON seed can drive them later.
    var swatchHex: String {
        switch self {
        case .threeDayGA:  "#F6D66F"   // SandFest yellow
        case .threeDayVIP: "#0E2A47"   // Gulf navy
        case .singleDay:   "#7DD3C0"   // Mint
        case .sponsor:     "#F08A5D"   // Coral
        case .staff:       "#2E5E5A"   // Deep teal
        case .raffle:      "#C97A3A"   // Burnt sand
        }
    }
}

struct Ticket: Identifiable, Codable {
    let id: String                 // also the QR payload (e.g., "tsf:t:WB-29F4-7B0A")
    let band: TicketBand
    let holder: String             // ticket holder name
    let dayPass: String            // "All 3 days · Apr 16-18" / "Friday only"
    let seat: String?              // VIP table number, sponsor zone, etc.
    let purchaseSource: String     // "Eventeny" / "Box Office" / "Comp"
    let issuedAt: Date
    let entryStatus: TicketEntryStatus
}

struct VenueZone: Identifiable, Codable {
    let id: String
    let name: String
    let marker: String
    let summary: String
    let status: ZoneStatus
}

enum ZoneStatus: String, Codable {
    case normal
    case busy
    case attention
}

struct IncidentDraft: Identifiable, Codable {
    let id: UUID
    var type: String
    var zoneId: String
    var severity: String
    var notes: String
    var createdAt: Date
    var syncedAt: Date?
}

struct SponsorAccount: Identifiable, Codable {
    let id: String
    let name: String
    let tier: String
    let invoiceStatus: String
    let fulfillmentStatus: String
    let nextAction: String
}

struct VendorApplication: Identifiable, Codable {
    let id: String
    let name: String
    let category: String
    let status: String
    let booth: String
}

struct VolunteerCoverage: Identifiable, Codable {
    let id: String
    let zone: String
    let filled: Int
    let needed: Int
}

struct FinanceSignal: Identifiable, Codable {
    let id: String
    let label: String
    let value: String
    let detail: String
}

struct TicketOption: Identifiable, Codable {
    let id: String
    let name: String
    let price: String
    let detail: String
}

struct SandFestPayload: Codable {
    let guide: EventGuide
    let alert: EmergencyAlert
    let schedule: [ScheduleItem]
    let zones: [VenueZone]
    let ticketOptions: [TicketOption]
    let sponsors: [SponsorAccount]
    let vendors: [VendorApplication]
    let coverage: [VolunteerCoverage]
    let financeSignals: [FinanceSignal]
    let myTickets: [Ticket]?       // optional so legacy seed JSON still decodes

    enum CodingKeys: String, CodingKey {
        case guide, alert, schedule, zones, ticketOptions, sponsors, vendors, coverage, financeSignals, myTickets
    }

    init(guide: EventGuide, alert: EmergencyAlert, schedule: [ScheduleItem], zones: [VenueZone], ticketOptions: [TicketOption], sponsors: [SponsorAccount], vendors: [VendorApplication], coverage: [VolunteerCoverage], financeSignals: [FinanceSignal], myTickets: [Ticket]? = nil) {
        self.guide = guide
        self.alert = alert
        self.schedule = schedule
        self.zones = zones
        self.ticketOptions = ticketOptions
        self.sponsors = sponsors
        self.vendors = vendors
        self.coverage = coverage
        self.financeSignals = financeSignals
        self.myTickets = myTickets
    }

    static let sample = SandFestPayload(
        guide: SampleData.guide,
        alert: .inactive,
        schedule: SampleData.schedule,
        zones: SampleData.zones,
        ticketOptions: SampleData.ticketOptions,
        sponsors: SampleData.sponsors,
        vendors: SampleData.vendors,
        coverage: SampleData.coverage,
        financeSignals: SampleData.financeSignals,
        myTickets: SampleData.myTickets
    )
}

// MARK: - Live Beach
//
// The visitor-facing surface that fuses crowd-zone density, run-of-show,
// the sculpture map, and the Sandy concierge into one screen. Mirrors the
// web `liveBeachContext` data; will eventually be served by the ops API.

enum SculptureCrowd: String, Codable {
    case light
    case moderate
    case packed

    var label: String {
        switch self {
        case .light: "Light"
        case .moderate: "Moderate"
        case .packed: "Packed"
        }
    }
}

struct Sculpture: Identifiable, Codable {
    let id: Int
    let x: Double          // 0..1, west → east along the beach
    let y: Double          // 0..1, dunes → surf
    let sculptor: String
    let country: String    // emoji flag
    let title: String      // signature phrase or piece title
    let category: String   // "Master Solo" / "Master Duo" / "Semi-Pro"
    let crowd: SculptureCrowd
    let state: String      // "carving", "talk", "judging"
    let bio: String        // 2–3 sentence sculptor + sculpture description
    let audioMinutes: String   // e.g. "4:12"
    let timelapseHours: String // e.g. "2h timelapse"
    let photoURL: String       // headshot/portfolio photo from texassandfest.org
}

enum BloomHue: String, Codable {
    case coral
    case mint
    case mixed
}

struct HeatBloom: Codable, Hashable {
    let x: Double
    let y: Double
    let intensity: Double  // 0..1
    let hue: BloomHue
}

struct VisitorPin: Codable {
    let x: Double
    let y: Double
}

struct SandySuggestion: Codable {
    let targetId: Int
    let walkMinutes: Int
    let reason: String
    let eventStartsInMin: Int
}

struct NowOnBeachCard: Identifiable, Codable {
    let id: String
    let kind: String       // "Top sculpture" / "Main stage" / "Shortest line"
    let title: String
    let meta: String
    let caption: String
    let pinId: Int?
}

struct TimelineFrame: Identifiable, Codable {
    var id: String { hour }
    let hour: String       // "12 PM"
    let label: String      // "Lunch surge"
    let preset: String     // early/rising/peak/balanced/evening
}

struct LiveBeachSnapshot: Codable {
    let sculptures: [Sculpture]
    let visitor: VisitorPin
    let blooms: [HeatBloom]
    let suggestion: SandySuggestion
    let nowOnBeach: [NowOnBeachCard]
    let timeline: [TimelineFrame]
}

enum SampleData {
    static let guide = EventGuide(
        id: "texas-sandfest-2027",
        name: "Texas SandFest",
        startDate: "2027-04-16",
        endDate: "2027-04-18",
        dateRange: "April 16-18, 2027",
        timeZone: "America/Chicago",
        location: "On the beach, Port Aransas, TX 78373",
        lastUpdated: Date()
    )

    static let schedule = [
        ScheduleItem(id: "fri-gates",     day: "Friday",   time: "9:00 AM",  title: "Beach gates open",          zone: "North Gate",            category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil),
        ScheduleItem(id: "fri-sculptors", day: "Friday",   time: "10:00 AM", title: "Master sculptor showcase",  zone: "Competition Corridor",  category: "Competition", stage: "Beach Walk",artist: "Master Solo Gallery", endTime: "5:00 PM",  durationMinutes: 420),
        ScheduleItem(id: "fri-band-1",    day: "Friday",   time: "11:30 AM", title: "Coastal Roots Trio",        zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Coastal Roots Trio", endTime: "12:45 PM", durationMinutes: 75),
        ScheduleItem(id: "fri-talk-1",    day: "Friday",   time: "1:00 PM",  title: "Live carving talk",         zone: "Sculpture #14",         category: "Talk",        stage: "Beach Walk",artist: "Cliff Vacheresse",   endTime: "1:30 PM",  durationMinutes: 30),
        ScheduleItem(id: "fri-band-2",    day: "Friday",   time: "3:00 PM",  title: "Gulf Wind String Band",     zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Gulf Wind String Band", endTime: "4:15 PM", durationMinutes: 75),
        ScheduleItem(id: "fri-family",    day: "Friday",   time: "2:00 PM",  title: "Youth build activation",    zone: "Family Sand Lab",       category: "Family",      stage: "Family Lab",artist: nil,                 endTime: "4:00 PM",  durationMinutes: 120),
        ScheduleItem(id: "fri-close",     day: "Friday",   time: "8:00 PM",  title: "Beach gates close",         zone: "All entry points",      category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil),

        ScheduleItem(id: "sat-gates",     day: "Saturday", time: "9:00 AM",  title: "Beach gates open",          zone: "North Gate",            category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil),
        ScheduleItem(id: "sat-brief",     day: "Saturday", time: "8:15 AM",  title: "Volunteer captain briefing", zone: "Command",              category: "Staff",       stage: nil,         artist: nil,                 endTime: "8:45 AM",  durationMinutes: 30),
        ScheduleItem(id: "sat-band-1",    day: "Saturday", time: "11:00 AM", title: "Las Olas Brass",            zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Las Olas Brass",     endTime: "12:15 PM", durationMinutes: 75),
        ScheduleItem(id: "sat-band-2",    day: "Saturday", time: "1:30 PM",  title: "Saltwater Blues Co.",       zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Saltwater Blues Co.",endTime: "3:00 PM",  durationMinutes: 90),
        ScheduleItem(id: "sat-vip",       day: "Saturday", time: "4:00 PM",  title: "Sponsor reception",         zone: "VIP deck",              category: "Sponsor",     stage: "Sponsor Harbor", artist: nil,            endTime: "6:00 PM",  durationMinutes: 120),
        ScheduleItem(id: "sat-headliner", day: "Saturday", time: "6:30 PM",  title: "Mustang Tide",              zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Mustang Tide",       endTime: "8:00 PM",  durationMinutes: 90),
        ScheduleItem(id: "sat-close",     day: "Saturday", time: "8:00 PM",  title: "Beach gates close",         zone: "All entry points",      category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil),

        ScheduleItem(id: "sun-gates",     day: "Sunday",   time: "9:00 AM",  title: "Beach gates open",          zone: "North Gate",            category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil),
        ScheduleItem(id: "sun-band-1",    day: "Sunday",   time: "11:00 AM", title: "Coastal Bend Folk",         zone: "Main Stage",            category: "Music",       stage: "Stage A",   artist: "Coastal Bend Folk",  endTime: "12:00 PM", durationMinutes: 60),
        ScheduleItem(id: "sun-awards",    day: "Sunday",   time: "12:30 PM", title: "Amateur awards",            zone: "Main Stage",            category: "Competition", stage: "Stage A",   artist: nil,                 endTime: "1:30 PM",  durationMinutes: 60),
        ScheduleItem(id: "sun-mawards",   day: "Sunday",   time: "3:00 PM",  title: "Master sculptor awards",    zone: "Main Stage",            category: "Competition", stage: "Stage A",   artist: nil,                 endTime: "4:30 PM",  durationMinutes: 90),
        ScheduleItem(id: "sun-final",     day: "Sunday",   time: "6:30 PM",  title: "Final beach sweep",         zone: "All zones",             category: "Operations",  stage: nil,         artist: nil,                 endTime: "8:00 PM",  durationMinutes: 90),
        ScheduleItem(id: "sun-close",     day: "Sunday",   time: "8:00 PM",  title: "Beach gates close",         zone: "All entry points",      category: "Visitor",     stage: nil,         artist: nil,                 endTime: nil,        durationMinutes: nil)
    ]

    static let zones = [
        VenueZone(id: "north-gate", name: "North Gate", marker: "12.5", summary: "Guest Relations, ticket scan, ADA parking, wristbands.", status: .busy),
        VenueZone(id: "competition", name: "Competition Corridor", marker: "13", summary: "Master, duo, semi-pro, advanced amateur, and amateur sculpture areas.", status: .normal),
        VenueZone(id: "south-gate", name: "South Entrance", marker: "Access Road 1A", summary: "Shuttle drop-off, south beer tent, food and vendor access.", status: .attention)
    ]

    static let ticketOptions = [
        TicketOption(id: "ga", name: "General Admission", price: "Eventeny", detail: "Public ticket purchase handoff. Keep final prices synced from Eventeny."),
        TicketOption(id: "vip", name: "VIP Wristbands", price: "Eventeny", detail: "VIP ticket handoff, menus, parking pass rules, and will-call instructions."),
        TicketOption(id: "raffle", name: "Golf Cart Raffle", price: "Eventeny", detail: "Raffle purchase handoff and post-event finance reconciliation.")
    ]

    static let sponsors = [
        SponsorAccount(id: "thomas-j-henry", name: "Thomas J. Henry", tier: "Whale+", invoiceStatus: "Needs QBO match", fulfillmentStatus: "Assets pending", nextAction: "Confirm logo package"),
        SponsorAccount(id: "heb", name: "H-E-B", tier: "Marlin", invoiceStatus: "Draft invoice", fulfillmentStatus: "Benefits mapped", nextAction: "Assign signage owner"),
        SponsorAccount(id: "local-partner", name: "Local Partner", tier: "Tarpon", invoiceStatus: "Paid", fulfillmentStatus: "On-site pending", nextAction: "Prepare impact report")
    ]

    static let vendors = [
        VendorApplication(id: "food-1", name: "Food Vendor", category: "Food", status: "Docs needed", booth: "Unassigned"),
        VendorApplication(id: "retail-1", name: "Coastal Retail", category: "Non-food", status: "Approved", booth: "V-14"),
        VendorApplication(id: "beverage-1", name: "Beverage Partner", category: "Beverage", status: "Inspection pending", booth: "B-2")
    ]

    static let coverage = [
        VolunteerCoverage(id: "north", zone: "North Gate", filled: 18, needed: 22),
        VolunteerCoverage(id: "south", zone: "South Entrance", filled: 14, needed: 16),
        VolunteerCoverage(id: "kids", zone: "Kids Corner", filled: 7, needed: 10),
        VolunteerCoverage(id: "ops", zone: "Command", filled: 6, needed: 6)
    ]

    static let financeSignals = [
        FinanceSignal(id: "qb", label: "QuickBooks", value: "Not connected", detail: "Ready for OAuth credentials, realm ID, and refresh token."),
        FinanceSignal(id: "sponsors", label: "Sponsor invoices", value: "3 staged", detail: "Mirror payment state after QBO access is connected."),
        FinanceSignal(id: "vendors", label: "Vendor finance", value: "2 review", detail: "Keep approval/load-in operational, accounting in QuickBooks."),
        FinanceSignal(id: "impact", label: "Impact report", value: "Draft", detail: "Finance review required before publishing donation/scholarship totals.")
    ]

    static let myTickets: [Ticket] = [
        Ticket(
            id: "tsf:t:WB-29F4-7B0A",
            band: .threeDayGA,
            holder: "Nick Merrill",
            dayPass: "All 3 days · Apr 16-18",
            seat: nil,
            purchaseSource: "Eventeny",
            issuedAt: Date(timeIntervalSince1970: 1_741_999_200),
            entryStatus: .unused
        ),
        Ticket(
            id: "tsf:t:WB-A18C-4D22",
            band: .threeDayVIP,
            holder: "Nick Merrill",
            dayPass: "All 3 days · Apr 16-18",
            seat: "VIP table 14 · Sponsor Harbor",
            purchaseSource: "Eventeny",
            issuedAt: Date(timeIntervalSince1970: 1_741_999_200),
            entryStatus: .unused
        )
    ]

    static let liveBeach = LiveBeachSnapshot(
        // Lineup pulled from texassandfest.org/master-solo-sculptors and /semi-pro-sculptors
        // for the 2026 lineup reference used by this prototype. Pieces are revealed at the festival; "title" is the sculptor's
        // most quotable signature phrase from their official bio. Photos are the official
        // headshots hosted on texassandfest.org.
        sculptures: [
            Sculpture(id: 1, x: 0.06, y: 0.42,
                sculptor: "Damon Langlois", country: "🇨🇦",
                title: "Five-time World Champion", category: "Master Solo",
                crowd: .moderate, state: "carving",
                bio: "Five-time world championship sand-sculpting winner and the designer of the tallest sand castle ever built (2015). Took the Texas SandFest crown in 2019. An author and industrial designer with fourteen patents in his other life.",
                audioMinutes: "5:48", timelapseHours: "Build · 3h timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_4f27a200b9454c9d942535cd82af2764~mv2.jpg"),
            Sculpture(id: 2, x: 0.12, y: 0.55,
                sculptor: "Bruce Peck", country: "🇺🇸",
                title: "Gulf Coast Convert", category: "Master Solo",
                crowd: .packed, state: "judging",
                bio: "Former CPA who walked away from spreadsheets after moving to Florida's Gulf Coast and finding sand. Now competes at Master level around the country. Placed fourth at a previous Texas SandFest.",
                audioMinutes: "4:30", timelapseHours: "Build · 2h 30m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_2423a86834ed478da9901f05c71b4e5f~mv2.jpg"),
            Sculpture(id: 3, x: 0.18, y: 0.40,
                sculptor: "Amanda Bolduc", country: "🇺🇸",
                title: "Combat Engineer Sculptor", category: "Master Solo",
                crowd: .packed, state: "carving",
                bio: "Former Army Combat Engineer Officer turned international sculptor. Competes in both sand and snow, representing Team USA at world championships. Real estate agent and restaurateur off-season.",
                audioMinutes: "4:14", timelapseHours: "Build · 2h 20m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_2dfa75f8ea8f459382563f522a99a1ec~mv2.jpeg"),
            Sculpture(id: 4, x: 0.24, y: 0.58,
                sculptor: "Slava Borecki", country: "🇵🇱",
                title: "Thirty Years in Sand", category: "Master Solo",
                crowd: .moderate, state: "carving",
                bio: "Freelance sculptor with over thirty years of experience working in sand, snow, ice, bronze, and stone across international festivals. Known for tightly engineered figurative pieces.",
                audioMinutes: "5:34", timelapseHours: "Build · 2h 50m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_75c3bff2befd4ffdbc6f60c8ddbabb70~mv2.jpg"),
            Sculpture(id: 5, x: 0.30, y: 0.43,
                sculptor: "Isabelle Gasse", country: "🇨🇦",
                title: "Race Against the Tide", category: "Master Solo",
                crowd: .moderate, state: "carving",
                bio: "Started ice sculpting at sixteen, transitioned to sand in 2021, and has been chasing tide deadlines ever since. Featured on the Canadian TV show 'Race Against the Tide.'",
                audioMinutes: "4:02", timelapseHours: "Build · 2h 15m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_d084816d276946ad87e47a21915e7993~mv2.jpg"),
            Sculpture(id: 6, x: 0.36, y: 0.56,
                sculptor: "Wade Lapp", country: "🇺🇸",
                title: "Pumpkins to Sand", category: "Master Solo",
                crowd: .light, state: "carving",
                bio: "Thirteen years of artistic journey from pumpkin carving to professional sand sculpting. Won first place in semi-professional competitions and People's Choice in Masters Doubles before moving up to Solo.",
                audioMinutes: "3:48", timelapseHours: "Build · 1h 50m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_1b27e2d86a6b493387c2bb372717b5b8~mv2.jpg"),
            Sculpture(id: 7, x: 0.42, y: 0.41,
                sculptor: "Delayne Corbett", country: "🇨🇦",
                title: "Unparalleled Exactitude", category: "Master Solo",
                crowd: .moderate, state: "talk",
                bio: "Master sand sculptor known for elaborate structures and figurative works of, in his bio's words, 'unparalleled exactitude.' Live carving talk starts in 12 minutes.",
                audioMinutes: "5:02", timelapseHours: "Build · 2h 20m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_3e21c75d58404bfaa24294a3875c5c3c~mv2.jpg"),
            Sculpture(id: 8, x: 0.48, y: 0.57,
                sculptor: "Justin Gordon", country: "🇺🇸",
                title: "Eight Mediums", category: "Master Solo",
                crowd: .light, state: "carving",
                bio: "Self-taught sculptor and wood carver since 1974. Works in eight mediums including sand, ice, stone, and wood. Has been teaching wood carving since 1996.",
                audioMinutes: "4:46", timelapseHours: "Build · 2h 25m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_19be0a57c61e4eec9286bc77b18e3057~mv2.jpg"),
            Sculpture(id: 9, x: 0.54, y: 0.44,
                sculptor: "Bruce Phillips", country: "🇺🇸",
                title: "Quarter Century in Sand", category: "Master Solo",
                crowd: .light, state: "carving",
                bio: "Sculpting in sand for over twenty-five years. Known internationally for festival, competition, and private commission work spanning architectural, mythic, and figurative subjects.",
                audioMinutes: "5:08", timelapseHours: "Build · 2h 30m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_a4eb6beadec44541b5e6897dfba64aee~mv2.jpg"),
            Sculpture(id: 10, x: 0.60, y: 0.55,
                sculptor: "Benjamin Probanza", country: "🇲🇽",
                title: "Sand Since 1988", category: "Master Solo",
                crowd: .moderate, state: "carving",
                bio: "Mexican master sculptor who started sand modeling in 1988 and took second prize at the first international Sand Sculpture Competition in 1997. Has competed globally since, collecting awards across continents.",
                audioMinutes: "6:18", timelapseHours: "Build · 2h 45m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_690754a816d44a5684a9d9c16290325c~mv2.jpg"),
            Sculpture(id: 11, x: 0.66, y: 0.40,
                sculptor: "Abe Waterman", country: "🇨🇦",
                title: "Stumble, Fall, Roll", category: "Master Solo",
                crowd: .light, state: "carving",
                bio: "Reigning Texas SandFest doubles champion (with Greg Grady), originally from Prince Edward Island. Self-described as someone who 'stumbles, falls, rolls, trips' through sand sculpture and life's absurdities.",
                audioMinutes: "5:21", timelapseHours: "Build · 2h 40m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_b94b7b0547e7421a963ce6c124ccfb40~mv2.jpg"),
            Sculpture(id: 12, x: 0.72, y: 0.58,
                sculptor: "Darrell O'Connor", country: "🇺🇸",
                title: "Forty Summers at Dewey", category: "Semi-Pro",
                crowd: .moderate, state: "carving",
                bio: "From Wilmington, Delaware. 'For the last forty years I've spent summer weekends building sandcastles at Dewey Beach.' Won Rehoboth nine times before going national.",
                audioMinutes: "3:12", timelapseHours: "Build · 1h 30m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_42f699a1071f42fb9a6918fa7a3df6b3~mv2.jpg"),
            Sculpture(id: 13, x: 0.78, y: 0.42,
                sculptor: "Niki McKenzie", country: "🇳🇿",
                title: "Six Mediums, Maori Roots", category: "Semi-Pro",
                crowd: .moderate, state: "carving",
                bio: "Originally from New Zealand, now based in Canada. Works in bronze, stone, wood, sand, ice, and pumpkin. Artistic director for the Snowking Festival; draws from her Maori heritage.",
                audioMinutes: "6:42", timelapseHours: "Build · 3h 10m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_9d8eed9d67ec46c4ba7e7099b5022431~mv2.jpg"),
            Sculpture(id: 14, x: 0.83, y: 0.56,
                sculptor: "Cliff Vacheresse", country: "🇨🇦",
                title: "Activate Arts Alberta", category: "Semi-Pro",
                crowd: .light, state: "talk",
                bio: "Forty-two years old, sculpting for almost fifteen of them. Lead sculptor for Activate Arts Alberta. Picked up sand six years ago and hasn't stopped. Live carving talk in 6 minutes.",
                audioMinutes: "4:55", timelapseHours: "Build · 3h timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_b4f87e042a1d4be4aa16ffdac90bf36f~mv2.jpg"),
            Sculpture(id: 15, x: 0.89, y: 0.43,
                sculptor: "Randy Ewing", country: "🇺🇸",
                title: "Theme Park Designer", category: "Semi-Pro",
                crowd: .light, state: "carving",
                bio: "Theme park designer for Disney, Universal, and Warner Bros. Creates character-focused sculptures inspired by children's stories. Recently relocated to Corpus Christi.",
                audioMinutes: "4:20", timelapseHours: "Build · 2h 35m timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_9463003cc5ca4d77ba153054c16455ab~mv2.jpeg"),
            Sculpture(id: 16, x: 0.94, y: 0.55,
                sculptor: "Dean Murray", country: "🇺🇸",
                title: "World-Champion Ice", category: "Semi-Pro",
                crowd: .moderate, state: "carving",
                bio: "World-Champion ice sculptor, renowned pumpkin carver, and prolific glass artist. Freelance artist out of Dallas who specializes in temporary mediums.",
                audioMinutes: "3:55", timelapseHours: "Build · 2h timelapse",
                photoURL: "https://static.wixstatic.com/media/f800df_be2954e2fe874da5a61a1b5da6878c9c~mv2.jpg")
        ],
        visitor: VisitorPin(x: 0.20, y: 0.62),
        blooms: [
            HeatBloom(x: 0.14, y: 0.50, intensity: 0.95, hue: .coral),
            HeatBloom(x: 0.34, y: 0.46, intensity: 0.55, hue: .mixed),
            HeatBloom(x: 0.58, y: 0.50, intensity: 0.30, hue: .mint),
            HeatBloom(x: 0.84, y: 0.50, intensity: 0.40, hue: .mint)
        ],
        suggestion: SandySuggestion(
            targetId: 14,
            walkMinutes: 4,
            reason: "Skip the south plaza (busy). Cliff Vacheresse is doing a live carving talk in 6 minutes, and the crowd is light.",
            eventStartsInMin: 6
        ),
        nowOnBeach: [
            NowOnBeachCard(id: "now-top",   kind: "Top sculpture", title: "Master Solo · Damon Langlois", meta: "🇨🇦 · Five-time World Champion", caption: "Time-lapse · 3h compressed → 22s", pinId: 1),
            NowOnBeachCard(id: "now-stage", kind: "Main stage",    title: "Coastal Roots Trio", meta: "Live · Stage A",   caption: "Set ends in 14 min — encore likely", pinId: nil),
            NowOnBeachCard(id: "now-line",  kind: "Shortest line", title: "El Tiburón Tacos",   meta: "Food Court",       caption: "≈ 3 min wait · cash + Apple Pay",    pinId: nil)
        ],
        timeline: [
            TimelineFrame(hour: "9 AM",  label: "Gates open",    preset: "early"),
            TimelineFrame(hour: "10 AM", label: "First carve",   preset: "early"),
            TimelineFrame(hour: "11 AM", label: "Family band",   preset: "rising"),
            TimelineFrame(hour: "12 PM", label: "Lunch surge",   preset: "peak"),
            TimelineFrame(hour: "1 PM",  label: "Heat watch",    preset: "peak"),
            TimelineFrame(hour: "2 PM",  label: "Youth build",   preset: "rising"),
            TimelineFrame(hour: "3 PM",  label: "Sponsor hour",  preset: "balanced"),
            TimelineFrame(hour: "4 PM",  label: "Master demos",  preset: "rising"),
            TimelineFrame(hour: "5 PM",  label: "Golden hour",   preset: "balanced"),
            TimelineFrame(hour: "6 PM",  label: "Stage set #2",  preset: "peak"),
            TimelineFrame(hour: "7 PM",  label: "Sunset photos", preset: "evening"),
            TimelineFrame(hour: "8 PM",  label: "Final sweep",   preset: "evening")
        ]
    )
}
