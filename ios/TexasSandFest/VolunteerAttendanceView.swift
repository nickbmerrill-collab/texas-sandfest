import SwiftUI

struct VolunteerAttendanceSummary: Codable, Equatable {
    let assigned: Int
    let scheduled: Int
    let checkedIn: Int
    let checkedOut: Int
    let exceptions: Int
}

struct VolunteerAttendanceAssignment: Identifiable, Codable, Equatable {
    let id: String
    let shiftId: String
    let volunteerId: String
    let volunteerName: String
    let volunteerStatus: String
    let roleId: String
    let zoneId: String
    let zoneLabel: String
    let day: String?
    let startsAt: String?
    let endsAt: String?
    let captain: Bool
    let attendanceStatus: String
    let attendanceId: String?
    let checkInAt: String?
    let checkOutAt: String?
    let hours: Double
    let canCheckIn: Bool
    let canCheckOut: Bool
}

struct VolunteerAttendanceBoard: Codable, Equatable {
    let assignments: [VolunteerAttendanceAssignment]
    let summary: VolunteerAttendanceSummary

    static let empty = VolunteerAttendanceBoard(
        assignments: [],
        summary: VolunteerAttendanceSummary(
            assigned: 0,
            scheduled: 0,
            checkedIn: 0,
            checkedOut: 0,
            exceptions: 0
        )
    )
}

private struct VolunteerDashboardPayload: Decodable {
    let attendance: VolunteerAttendanceBoard
}

private struct VolunteerAttendanceMutationPayload: Decodable {
    let replay: Bool
    let attendanceBoard: VolunteerAttendanceBoard
}

private struct VolunteerAttendanceMutationBody: Encodable {
    let action: String
    let volunteerId: String
    let shiftId: String
    let attendanceId: String?
    let method: String
}

private struct VolunteerAttendanceErrorPayload: Decodable {
    let error: String
}

@MainActor
final class NativeVolunteerAttendanceStore: ObservableObject {
    @Published private(set) var board = VolunteerAttendanceBoard.empty
    @Published private(set) var source = "Board session required"
    @Published private(set) var lastError: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var isMutating = false

    private let transport: AppDataTransport

    init(transport: AppDataTransport = .live) {
        self.transport = transport
    }

    func refresh(request: URLRequest?) async {
        guard let request else {
            source = "Board session required"
            lastError = "Authenticated board volunteer access is unavailable."
            return
        }
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let response = try await transport.load(request)
            guard response.statusCode == 200 else {
                throw NativeVolunteerAttendanceError.api(
                    message(from: response.data, fallback: "Volunteer API \(response.statusCode)")
                )
            }
            let payload = try Self.decoder.decode(VolunteerDashboardPayload.self, from: response.data)
            board = try Self.validated(payload.attendance)
            source = "Live shared shift roster"
            lastError = nil
        } catch {
            lastError = errorMessage(error, fallback: "Volunteer refresh failed. Existing attendance was not changed.")
        }
    }

    @discardableResult
    func record(_ assignment: VolunteerAttendanceAssignment, request: URLRequest?) async -> Bool {
        guard let request else {
            lastError = "Authenticated board volunteer access is unavailable; no attendance state was changed."
            return false
        }
        guard !isMutating else {
            lastError = "Another attendance change is still in progress."
            return false
        }

        let action: String
        if assignment.canCheckOut {
            action = "check_out"
        } else if assignment.canCheckIn {
            action = "check_in"
        } else {
            lastError = "This shift assignment is not available for an attendance change."
            return false
        }

        isMutating = true
        defer { isMutating = false }

        do {
            var mutationRequest = request
            mutationRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            mutationRequest.httpBody = try Self.encoder.encode(
                VolunteerAttendanceMutationBody(
                    action: action,
                    volunteerId: assignment.volunteerId,
                    shiftId: assignment.shiftId,
                    attendanceId: action == "check_out" ? assignment.attendanceId : nil,
                    method: "mobile"
                )
            )
            let response = try await transport.load(mutationRequest)
            guard response.statusCode == 200 else {
                throw NativeVolunteerAttendanceError.api(
                    message(from: response.data, fallback: "Attendance API \(response.statusCode)")
                )
            }
            let payload = try Self.decoder.decode(VolunteerAttendanceMutationPayload.self, from: response.data)
            board = try Self.validated(payload.attendanceBoard)
            source = payload.replay ? "Live shared shift roster - already current" : "Live shared shift roster"
            lastError = nil
            return true
        } catch {
            lastError = errorMessage(error, fallback: "Attendance request failed; existing attendance was not changed.")
            return false
        }
    }

    private static func validated(_ board: VolunteerAttendanceBoard) throws -> VolunteerAttendanceBoard {
        guard board.assignments.count <= 5_000,
              board.summary.assigned == board.assignments.count,
              Set(board.assignments.map(\.id)).count == board.assignments.count,
              board.assignments.allSatisfy({
                  !$0.id.isEmpty && !$0.shiftId.isEmpty && !$0.volunteerId.isEmpty && !$0.volunteerName.isEmpty
              }) else {
            throw NativeVolunteerAttendanceError.invalidResponse
        }
        return board
    }

    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    private func message(from data: Data, fallback: String) -> String {
        (try? Self.decoder.decode(VolunteerAttendanceErrorPayload.self, from: data))?.error ?? fallback
    }

    private func errorMessage(_ error: Error, fallback: String) -> String {
        if case let NativeVolunteerAttendanceError.api(message) = error { return message }
        return fallback
    }
}

private enum NativeVolunteerAttendanceError: Error {
    case api(String)
    case invalidResponse
}

struct VolunteerAttendanceView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @StateObject private var store = NativeVolunteerAttendanceStore()
    @State private var filter: VolunteerAttendanceFilter = .onShift

    private var visibleAssignments: [VolunteerAttendanceAssignment] {
        let assignments: [VolunteerAttendanceAssignment]
        switch filter {
        case .onShift:
            assignments = store.board.assignments.filter { $0.attendanceStatus == "checked_in" }
        case .scheduled:
            assignments = store.board.assignments.filter { $0.attendanceStatus == "scheduled" }
        case .complete:
            assignments = store.board.assignments.filter { $0.attendanceStatus == "checked_out" }
        case .all:
            assignments = store.board.assignments
        }
        return assignments.sorted { left, right in
            if left.startsAt != right.startsAt { return (left.startsAt ?? "9999") < (right.startsAt ?? "9999") }
            return left.volunteerName.localizedCaseInsensitiveCompare(right.volunteerName) == .orderedAscending
        }
    }

    var body: some View {
        List {
            Section {
                summary
                Picker("Attendance Filter", selection: $filter) {
                    ForEach(VolunteerAttendanceFilter.allCases) { item in
                        Text(item.title).tag(item)
                    }
                }
                .pickerStyle(.segmented)
            }

            if let error = store.lastError {
                Section {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.sandFestCoral)
                }
            }

            Section("Shift Assignments") {
                if visibleAssignments.isEmpty {
                    ContentUnavailableView(emptyTitle, systemImage: "person.crop.circle.badge.checkmark")
                } else {
                    ForEach(visibleAssignments) { assignment in
                        assignmentRow(assignment)
                            .accessibilityIdentifier("volunteer-attendance-\(assignment.id)")
                    }
                }
            }

            Section {
                Label(store.source, systemImage: store.lastError == nil ? "checkmark.circle.fill" : "externaldrive")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(store.lastError == nil ? Color.sandFestGulf : .secondary)
            }
        }
        .navigationTitle("Shift Attendance")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(store.isRefreshing || store.isMutating)
            }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
    }

    private var summary: some View {
        HStack(spacing: 8) {
            summaryTile("Assigned", store.board.summary.assigned, Color.sandFestDeep)
            summaryTile("On shift", store.board.summary.checkedIn, Color.sandFestGulf)
            summaryTile("Complete", store.board.summary.checkedOut, Color.sandFestSun)
            summaryTile("Exceptions", store.board.summary.exceptions, Color.sandFestCoral)
        }
        .padding(.vertical, 4)
    }

    private func summaryTile(_ label: String, _ value: Int, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value.formatted())
                .font(.title3.weight(.bold))
                .foregroundStyle(color)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .padding(.horizontal, 7)
        .background(color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func assignmentRow(_ assignment: VolunteerAttendanceAssignment) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(assignment.volunteerName)
                    .font(.headline)
                if assignment.captain {
                    Image(systemName: "star.fill")
                        .font(.caption)
                        .foregroundStyle(Color.sandFestSun)
                        .accessibilityLabel("Captain")
                }
                Spacer()
                Text(statusTitle(assignment.attendanceStatus))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(statusColor(assignment.attendanceStatus))
            }

            Text("\(roleTitle(assignment.roleId)) · \(assignment.zoneLabel)")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(alignment: .center, spacing: 10) {
                Label(shiftLabel(assignment), systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if assignment.canCheckIn || assignment.canCheckOut {
                    Button {
                        Task { await record(assignment) }
                    } label: {
                        Label(
                            assignment.canCheckOut ? "Check Out" : "Check In",
                            systemImage: assignment.canCheckOut ? "rectangle.portrait.and.arrow.right" : "rectangle.portrait.and.arrow.forward"
                        )
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(assignment.canCheckOut ? Color.sandFestCoral : Color.sandFestGulf)
                    .disabled(store.isMutating || store.isRefreshing)
                } else if assignment.attendanceStatus == "checked_out" {
                    Text("\(assignment.hours.formatted(.number.precision(.fractionLength(1)))) hr")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.sandFestDeep)
                }
            }
        }
        .padding(.vertical, 5)
    }

    private var emptyTitle: String {
        switch filter {
        case .onShift: "No volunteers on shift"
        case .scheduled: "No scheduled volunteers"
        case .complete: "No completed shifts"
        case .all: "No shift assignments"
        }
    }

    private func refresh() async {
        await store.refresh(request: dataStore.makeBoardAdminRequest(path: "/api/admin/volunteers"))
    }

    private func record(_ assignment: VolunteerAttendanceAssignment) async {
        _ = await store.record(
            assignment,
            request: dataStore.makeBoardAdminRequest(path: "/api/admin/volunteers/attendance", method: "POST")
        )
    }

    private func statusTitle(_ status: String) -> String {
        switch status {
        case "checked_in": "On shift"
        case "checked_out": "Complete"
        case "checked_in_elsewhere": "Other shift"
        case "no_show": "No show"
        case "cancelled": "Cancelled"
        default: "Scheduled"
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "checked_in": Color.sandFestGulf
        case "checked_out": Color.sandFestDeep
        case "no_show", "cancelled", "checked_in_elsewhere": Color.sandFestCoral
        default: Color.secondary
        }
    }

    private func roleTitle(_ role: String) -> String {
        role.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ").capitalized
    }

    private func shiftLabel(_ assignment: VolunteerAttendanceAssignment) -> String {
        let day = assignment.day ?? "Shift"
        guard let startsAt = assignment.startsAt,
              let start = try? Date(startsAt, strategy: .iso8601) else { return day }
        if let endsAt = assignment.endsAt,
           let end = try? Date(endsAt, strategy: .iso8601) {
            return "\(day) · \(start.formatted(date: .omitted, time: .shortened))-\(end.formatted(date: .omitted, time: .shortened))"
        }
        return "\(day) · \(start.formatted(date: .omitted, time: .shortened))"
    }
}

private enum VolunteerAttendanceFilter: String, CaseIterable, Identifiable {
    case onShift
    case scheduled
    case complete
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .onShift: "On Shift"
        case .scheduled: "Scheduled"
        case .complete: "Complete"
        case .all: "All"
        }
    }
}
