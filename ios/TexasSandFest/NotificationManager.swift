import Foundation
import UserNotifications

/// Local-notification scaffolding for SandFest reminders. Live admin alerts will
/// arrive via APNs through the existing /api/admin/alert publishing flow; this
/// manager handles everything that's known in advance — set-time reminders,
/// gates open / close, and the user's starred-item alerts.
@MainActor
final class NotificationManager: ObservableObject {
    static let shared = NotificationManager()

    @Published private(set) var authorization: UNAuthorizationStatus = .notDetermined

    private let center = UNUserNotificationCenter.current()
    private let calendar = Calendar(identifier: .gregorian)

    private init() {
        Task { await refreshAuthorization() }
    }

    func refreshAuthorization() async {
        let settings = await center.notificationSettings()
        authorization = settings.authorizationStatus
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorization()
            return granted
        } catch {
            return false
        }
    }

    /// Reminder identifiers are deterministic so we can cancel by item id.
    func reminderIdentifier(for itemId: String, leadMinutes: Int) -> String {
        "tsf.reminder.\(itemId).lead\(leadMinutes)"
    }

    /// Schedule a reminder N minutes before the given fire date.
    /// `body` should already be in the form "Coastal Roots Trio · Stage A".
    func scheduleReminder(itemId: String, title: String, body: String, fireDate: Date, leadMinutes: Int = 15) async {
        guard let triggerDate = calendar.date(byAdding: .minute, value: -leadMinutes, to: fireDate) else { return }
        guard triggerDate > Date() else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body  = body
        content.sound = .default
        content.categoryIdentifier = "tsf.reminder"
        content.userInfo = ["itemId": itemId, "leadMinutes": leadMinutes]

        let comps = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: triggerDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)

        let request = UNNotificationRequest(
            identifier: reminderIdentifier(for: itemId, leadMinutes: leadMinutes),
            content: content,
            trigger: trigger
        )
        try? await center.add(request)
    }

    func cancelReminder(itemId: String, leadMinutes: Int = 15) {
        center.removePendingNotificationRequests(
            withIdentifiers: [reminderIdentifier(for: itemId, leadMinutes: leadMinutes)]
        )
    }

    func cancelAllReminders() {
        center.removeAllPendingNotificationRequests()
    }

    /// Useful for the demo-mode "fire one in 10 seconds" button.
    func scheduleDemoReminder(seconds: TimeInterval = 10) async {
        let content = UNMutableNotificationContent()
        content.title = "Mustang Tide takes Stage A in 15 min"
        content.body  = "Save your spot — golden hour is starting."
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: seconds, repeats: false)
        let request = UNNotificationRequest(identifier: "tsf.demo.\(UUID().uuidString)", content: content, trigger: trigger)
        try? await center.add(request)
    }
}
