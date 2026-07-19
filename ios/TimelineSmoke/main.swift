import Foundation

let seedData = try Data(contentsOf: URL(fileURLWithPath: "Resources/sandfest-seed.json"))
let decoder = JSONDecoder()
decoder.dateDecodingStrategy = .iso8601
let seed = try decoder.decode(SandFestPayload.self, from: seedData)
precondition(seed.guide.id == "texas-sandfest-2027")
precondition(seed.guide.startDate == "2027-04-16")
precondition(seed.guide.endDate == "2027-04-18")
precondition(seed.guide.timeZone == "America/Chicago")

let guide = EventGuide(
    id: "texas-sandfest-2027",
    name: "Texas SandFest",
    startDate: "2027-04-16",
    endDate: "2027-04-18",
    dateRange: "April 16-18, 2027",
    timeZone: "America/Chicago",
    location: "Port Aransas beach",
    lastUpdated: Date()
)

let fridayItem = ScheduleItem(
    id: "friday-test",
    day: "Friday",
    time: "11:30 AM",
    title: "Timeline test",
    zone: "Main Stage",
    category: "Test",
    stage: nil,
    artist: nil,
    endTime: "12:30 PM",
    durationMinutes: 60
)

let saturdayItem = ScheduleItem(
    id: "saturday-test",
    day: "Saturday",
    time: "1:00 PM",
    title: "Timeline test",
    zone: "Main Stage",
    category: "Test",
    stage: nil,
    artist: nil,
    endTime: "2:00 PM",
    durationMinutes: 60
)

let timeZone = TimeZone(identifier: "America/Chicago")!
var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = timeZone

let friday = LiveTimeline.date(for: fridayItem, guide: guide)!
let fridayParts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: friday)
precondition(fridayParts.year == 2027)
precondition(fridayParts.month == 4)
precondition(fridayParts.day == 16)
precondition(fridayParts.hour == 11)
precondition(fridayParts.minute == 30)
precondition(LiveTimeline.shortDate(for: "Saturday", guide: guide) == "Apr 17")
precondition(LiveTimeline.shortDateRange(for: guide) == "Apr 16-18")
precondition(LiveTimeline.eventYear(for: guide) == "2027")

let saturdayReference = calendar.date(from: DateComponents(
    timeZone: timeZone,
    year: 2027,
    month: 4,
    day: 17,
    hour: 13,
    minute: 30
))!
precondition(LiveTimeline.currentFestivalDay(for: guide, at: saturdayReference) == "Saturday")

let summary = LiveTimeline.summarize(
    [fridayItem, saturdayItem],
    guide: guide,
    at: saturdayReference
)
precondition(summary.nowPlaying.map(\.id) == [saturdayItem.id])
precondition(LiveTimeline.minutesLeft(for: saturdayItem, guide: guide, at: saturdayReference) == 30)

print("Swift timeline smoke: Texas SandFest 2027 dates resolved from EventGuide")
