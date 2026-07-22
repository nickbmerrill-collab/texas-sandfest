import SwiftUI

struct StaffTask: Identifiable, Codable, Equatable {
    let id: String
    let title: String
    let description: String
    let status: String
    let priority: String
    let assigneeType: String
    let assigneeId: String?
    let assigneeName: String?
    let assigneeRole: String?
    let relatedEntityType: String?
    let relatedEntityId: String?
    let dueAt: String?
    let createdAt: String
    let updatedAt: String
    let completedAt: String?
    let assignmentVersion: Int
    let assignmentNoticeVersion: Int
    let scheduleVersion: Int
    let acknowledgedAt: String?
    let notificationSummary: StaffTaskNotificationSummary?
}

struct StaffTaskNotificationSummary: Codable, Equatable {
    let count: Int
    let latestStatus: String?
    let assignmentLabel: String
    let followupLabel: String?
}

struct TaskBoardTotals: Codable, Equatable {
    let total: Int
    let active: Int
    let open: Int
    let inProgress: Int
    let blocked: Int
    let overdue: Int
    let dueToday: Int
    let unassigned: Int
    let completed: Int
    let cancelled: Int
}

struct TaskBoardSnapshot: Codable, Equatable {
    let generatedAt: String
    let totals: TaskBoardTotals
}

struct TaskAssignee: Identifiable, Codable, Equatable, Hashable {
    let id: String
    let name: String
    let status: String?
    let roles: [String]?
    let notificationReady: Bool?
    let emailAvailable: Bool?
}

struct TaskAssignmentDirectory: Codable, Equatable {
    let teams: [TaskAssignee]
    let staff: [TaskAssignee]
    let volunteers: [TaskAssignee]

    static let empty = TaskAssignmentDirectory(teams: [], staff: [], volunteers: [])

    func options(for type: String) -> [TaskAssignee] {
        switch type {
        case "team":
            return teams
        case "staff":
            return staff.filter { ["active", "on_call"].contains($0.status ?? "active") }
        case "volunteer":
            return volunteers.filter { !["no_show", "withdrawn", "inactive"].contains($0.status ?? "confirmed") }
        default:
            return []
        }
    }
}

struct TaskWorkspacePayload: Codable, Equatable {
    let tasks: [StaffTask]
    let taskBoard: TaskBoardSnapshot
    let assignmentDirectory: TaskAssignmentDirectory
}

private struct StaffTaskMutationPayload: Decodable {
    let task: StaffTask
}

private struct StaffTaskErrorPayload: Decodable {
    let error: String
}

struct StaffTaskSubmission {
    let title: String
    let description: String
    let status: String
    let priority: String
    let assigneeType: String
    let assigneeId: String?
    let dueAt: Date?
}

private struct StaffTaskCreateBody: Encodable {
    let title: String
    let description: String
    let priority: String
    let assigneeType: String
    let assigneeId: String?
    let dueAt: Date?
}

private struct StaffTaskUpdateBody: Encodable {
    let title: String
    let description: String
    let status: String
    let priority: String
    let assigneeType: String
    let assigneeId: String?
    let dueAt: Date?
}

private struct StaffTaskNoticeBody: Encodable {
    let requestId: String
}

@MainActor
final class NativeTaskBoardStore: ObservableObject {
    @Published private(set) var tasks: [StaffTask] = []
    @Published private(set) var totals: TaskBoardTotals?
    @Published private(set) var assignmentDirectory = TaskAssignmentDirectory.empty
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
            lastError = "Authenticated board task access is unavailable."
            source = "Board session required"
            return
        }
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let response = try await transport.load(request)
            guard response.statusCode == 200 else {
                throw NativeTaskBoardError.api(message(from: response.data, fallback: "Task API \(response.statusCode)"))
            }
            let payload = try Self.decoder.decode(TaskWorkspacePayload.self, from: response.data)
            guard payload.tasks.count <= 2_000,
                  Set(payload.tasks.map(\.id)).count == payload.tasks.count,
                  payload.tasks.allSatisfy({ !$0.id.isEmpty && !$0.title.isEmpty }) else {
                throw NativeTaskBoardError.invalidResponse
            }
            tasks = Self.sorted(payload.tasks)
            totals = payload.taskBoard.totals
            assignmentDirectory = payload.assignmentDirectory
            source = "Live shared work board"
            lastError = nil
        } catch {
            lastError = errorMessage(error, fallback: "Task refresh failed. Existing task data was not changed.")
        }
    }

    func createTask(
        _ submission: StaffTaskSubmission,
        request: URLRequest?,
        refreshRequest: URLRequest?
    ) async -> StaffTask? {
        guard let request else {
            lastError = "Authenticated board task access is unavailable; no task was created."
            return nil
        }
        let title = submission.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            lastError = "Task title is required."
            return nil
        }
        let body = StaffTaskCreateBody(
            title: title,
            description: submission.description.trimmingCharacters(in: .whitespacesAndNewlines),
            priority: submission.priority,
            assigneeType: submission.assigneeType,
            assigneeId: Self.ownerID(submission),
            dueAt: submission.dueAt
        )
        guard let task = await mutate(request: request, body: body, allowedStatuses: [201]) else { return nil }
        await refreshAfterMutation(refreshRequest)
        return task
    }

    func updateTask(
        _ submission: StaffTaskSubmission,
        request: URLRequest?,
        refreshRequest: URLRequest?
    ) async -> Bool {
        guard let request else {
            lastError = "Authenticated board task access is unavailable; no task state was changed."
            return false
        }
        let title = submission.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            lastError = "Task title is required."
            return false
        }
        let body = StaffTaskUpdateBody(
            title: title,
            description: submission.description.trimmingCharacters(in: .whitespacesAndNewlines),
            status: submission.status,
            priority: submission.priority,
            assigneeType: submission.assigneeType,
            assigneeId: Self.ownerID(submission),
            dueAt: submission.dueAt
        )
        guard await mutate(request: request, body: body, allowedStatuses: [200]) != nil else { return false }
        await refreshAfterMutation(refreshRequest)
        return true
    }

    func requestAssignmentNotice(request: URLRequest?, refreshRequest: URLRequest?) async -> Bool {
        guard let request else {
            lastError = "Authenticated board task access is unavailable; no assignment notice was prepared."
            return false
        }
        let body = StaffTaskNoticeBody(requestId: "ios-\(UUID().uuidString.lowercased())")
        guard await mutate(request: request, body: body, allowedStatuses: [200, 202]) != nil else { return false }
        await refreshAfterMutation(refreshRequest)
        return true
    }

    private func mutate<Body: Encodable>(
        request inputRequest: URLRequest,
        body: Body,
        allowedStatuses: Set<Int>
    ) async -> StaffTask? {
        guard !isMutating else {
            lastError = "Another task change is still in progress."
            return nil
        }
        isMutating = true
        defer { isMutating = false }

        do {
            var request = inputRequest
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(body)
            let response = try await transport.load(request)
            guard allowedStatuses.contains(response.statusCode) else {
                throw NativeTaskBoardError.api(message(from: response.data, fallback: "Task API \(response.statusCode)"))
            }
            let payload = try Self.decoder.decode(StaffTaskMutationPayload.self, from: response.data)
            apply(payload.task)
            source = "Live shared work board"
            lastError = nil
            return payload.task
        } catch {
            lastError = errorMessage(error, fallback: "Task request failed; no local task state was changed.")
            return nil
        }
    }

    private func refreshAfterMutation(_ request: URLRequest?) async {
        guard let request else { return }
        await refresh(request: request)
    }

    private func apply(_ task: StaffTask) {
        if let index = tasks.firstIndex(where: { $0.id == task.id }) {
            tasks[index] = task
        } else {
            tasks.append(task)
        }
        tasks = Self.sorted(tasks)
    }

    private static func ownerID(_ submission: StaffTaskSubmission) -> String? {
        guard submission.assigneeType != "unassigned" else { return nil }
        let value = submission.assigneeId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    private static func sorted(_ tasks: [StaffTask]) -> [StaffTask] {
        tasks.sorted { lhs, rhs in
            let lhsRank = sortRank(lhs)
            let rhsRank = sortRank(rhs)
            if lhsRank != rhsRank { return lhsRank < rhsRank }
            if lhs.dueAt != rhs.dueAt { return (lhs.dueAt ?? "9999") < (rhs.dueAt ?? "9999") }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private static func sortRank(_ task: StaffTask) -> Int {
        if task.status == "blocked" { return 0 }
        if task.priority == "urgent" && !task.isTerminal { return 1 }
        if task.isOverdue { return 2 }
        if !task.isTerminal { return 3 }
        return 4
    }

    private static var decoder: JSONDecoder { JSONDecoder() }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private func message(from data: Data, fallback: String) -> String {
        (try? Self.decoder.decode(StaffTaskErrorPayload.self, from: data))?.error ?? fallback
    }

    private func errorMessage(_ error: Error, fallback: String) -> String {
        if case let NativeTaskBoardError.api(message) = error { return message }
        if case NativeTaskBoardError.invalidResponse = error { return fallback }
        return fallback
    }
}

private enum NativeTaskBoardError: Error {
    case api(String)
    case invalidResponse
}

extension StaffTask {
    var isTerminal: Bool { ["done", "cancelled"].contains(status) }

    var dueDate: Date? {
        guard let dueAt else { return nil }
        return try? Date(dueAt, strategy: .iso8601)
    }

    var isOverdue: Bool {
        guard !isTerminal, let dueDate else { return false }
        return dueDate < Date()
    }
}

struct NativeTaskBoardView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @StateObject private var store = NativeTaskBoardStore()
    @State private var filter: NativeTaskFilter = .active
    @State private var selectedTask: StaffTask?
    @State private var showingCreate = false

    private var visibleTasks: [StaffTask] {
        switch filter {
        case .active:
            store.tasks.filter { !$0.isTerminal }
        case .blocked:
            store.tasks.filter { $0.status == "blocked" }
        case .complete:
            store.tasks.filter(\.isTerminal)
        case .all:
            store.tasks
        }
    }

    var body: some View {
        List {
            Section {
                summary
                Picker("Task Filter", selection: $filter) {
                    ForEach(NativeTaskFilter.allCases) { item in
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

            Section("Assignments") {
                if visibleTasks.isEmpty {
                    ContentUnavailableView("No tasks", systemImage: "checkmark.circle")
                } else {
                    ForEach(visibleTasks) { task in
                        Button {
                            selectedTask = task
                        } label: {
                            taskRow(task)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .navigationTitle("Work Board")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(store.isRefreshing || store.isMutating)

                Button {
                    showingCreate = true
                } label: {
                    Label("Delegate Task", systemImage: "plus")
                }
                .disabled(store.isMutating)
            }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
        .sheet(isPresented: $showingCreate) {
            NavigationStack {
                NativeTaskEditor(
                    task: nil,
                    assignmentDirectory: store.assignmentDirectory,
                    onSave: createTask
                )
            }
        }
        .sheet(item: $selectedTask) { task in
            NavigationStack {
                NativeTaskEditor(
                    task: task,
                    assignmentDirectory: store.assignmentDirectory,
                    onSave: { submission in await updateTask(task.id, submission) },
                    onNotice: { await prepareNotice(task.id) }
                )
            }
        }
    }

    private var summary: some View {
        HStack(spacing: 8) {
            summaryTile("Active", store.totals?.active ?? 0, Color.sandFestGulf)
            summaryTile("Overdue", store.totals?.overdue ?? 0, Color.sandFestCoral)
            summaryTile("Blocked", store.totals?.blocked ?? 0, Color.sandFestSun)
            summaryTile("Unassigned", store.totals?.unassigned ?? 0, Color.secondary)
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
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
        .padding(.horizontal, 8)
        .background(color.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func taskRow(_ task: StaffTask) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 2)
                .fill(priorityColor(task.priority))
                .frame(width: 5, height: 48)
            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .firstTextBaseline) {
                    Text(task.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Spacer()
                    Text(statusLabel(task.status))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(task.status == "blocked" ? Color.sandFestCoral : Color.sandFestDeep)
                }
                Text(task.assigneeName ?? "Unassigned")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                HStack {
                    Label(dueLabel(task), systemImage: task.isOverdue ? "exclamationmark.clock.fill" : "calendar")
                    Spacer()
                    Text(statusLabel(task.priority))
                }
                .font(.caption)
                .foregroundStyle(task.isOverdue ? Color.sandFestCoral : .secondary)
            }
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
    }

    private func refresh() async {
        await store.refresh(request: dataStore.makeBoardAdminRequest(path: "/api/admin/partners"))
    }

    private func createTask(_ submission: StaffTaskSubmission) async -> String? {
        let task = await store.createTask(
            submission,
            request: dataStore.makeBoardAdminRequest(path: "/api/admin/partners/tasks", method: "POST"),
            refreshRequest: dataStore.makeBoardAdminRequest(path: "/api/admin/partners")
        )
        guard task != nil else { return store.lastError ?? "Task could not be created." }
        await dataStore.refreshPublicData()
        return nil
    }

    private func updateTask(_ id: String, _ submission: StaffTaskSubmission) async -> String? {
        let updated = await store.updateTask(
            submission,
            request: dataStore.makeBoardAdminRequest(path: "/api/admin/partners/tasks/\(id)", method: "PATCH"),
            refreshRequest: dataStore.makeBoardAdminRequest(path: "/api/admin/partners")
        )
        guard updated else { return store.lastError ?? "Task could not be updated." }
        await dataStore.refreshPublicData()
        return nil
    }

    private func prepareNotice(_ id: String) async -> String? {
        let prepared = await store.requestAssignmentNotice(
            request: dataStore.makeBoardAdminRequest(path: "/api/admin/partners/tasks/\(id)/assignment-notice", method: "POST"),
            refreshRequest: dataStore.makeBoardAdminRequest(path: "/api/admin/partners")
        )
        return prepared ? nil : store.lastError ?? "Assignment notice could not be prepared."
    }

    private func dueLabel(_ task: StaffTask) -> String {
        guard let date = task.dueDate else { return "No due date" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func priorityColor(_ priority: String) -> Color {
        switch priority {
        case "urgent": Color.sandFestCoral
        case "high": Color.sandFestSun
        case "low": Color.secondary
        default: Color.sandFestGulf
        }
    }
}

private enum NativeTaskFilter: String, CaseIterable, Identifiable {
    case active
    case blocked
    case complete
    case all

    var id: String { rawValue }
    var title: String { statusLabel(rawValue) }
}

private struct NativeTaskEditor: View {
    @Environment(\.dismiss) private var dismiss
    let task: StaffTask?
    let assignmentDirectory: TaskAssignmentDirectory
    let onSave: (StaffTaskSubmission) async -> String?
    var onNotice: (() async -> String?)?

    @State private var title: String
    @State private var description: String
    @State private var status: String
    @State private var priority: String
    @State private var assigneeType: String
    @State private var assigneeId: String
    @State private var hasDueDate: Bool
    @State private var dueAt: Date
    @State private var isSaving = false
    @State private var isPreparingNotice = false
    @State private var errorMessage: String?

    init(
        task: StaffTask?,
        assignmentDirectory: TaskAssignmentDirectory,
        onSave: @escaping (StaffTaskSubmission) async -> String?,
        onNotice: (() async -> String?)? = nil
    ) {
        self.task = task
        self.assignmentDirectory = assignmentDirectory
        self.onSave = onSave
        self.onNotice = onNotice
        let initialType = task?.assigneeType ?? "team"
        let initialOwner = task?.assigneeId
            ?? assignmentDirectory.options(for: initialType).first?.id
            ?? ""
        _title = State(initialValue: task?.title ?? "")
        _description = State(initialValue: task?.description ?? "")
        _status = State(initialValue: task?.status ?? "open")
        _priority = State(initialValue: task?.priority ?? "normal")
        _assigneeType = State(initialValue: initialType)
        _assigneeId = State(initialValue: initialOwner)
        _hasDueDate = State(initialValue: task?.dueDate != nil)
        _dueAt = State(initialValue: task?.dueDate ?? Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date())
    }

    private var ownerOptions: [TaskAssignee] {
        assignmentDirectory.options(for: assigneeType)
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (assigneeType == "unassigned" || !assigneeId.isEmpty)
            && !isSaving
            && !isPreparingNotice
    }

    var body: some View {
        Form {
            Section("Task") {
                TextField("Title", text: $title)
                TextField("Description", text: $description, axis: .vertical)
                    .lineLimit(3...6)
                Picker("Priority", selection: $priority) {
                    taskOptions(["low", "normal", "high", "urgent"])
                }
                if task != nil {
                    Picker("Status", selection: $status) {
                        taskOptions(["open", "in_progress", "blocked", "done", "cancelled"])
                    }
                }
            }

            Section("Assignment") {
                Picker("Type", selection: $assigneeType) {
                    Text("Team").tag("team")
                    Text("Staff").tag("staff")
                    Text("Volunteer").tag("volunteer")
                    Text("Unassigned").tag("unassigned")
                }
                if assigneeType != "unassigned" {
                    Picker("Owner", selection: $assigneeId) {
                        ForEach(ownerOptions) { owner in
                            Text(owner.name).tag(owner.id)
                        }
                    }
                }
            }

            Section("Due Date") {
                Toggle("Scheduled", isOn: $hasDueDate)
                if hasDueDate {
                    DatePicker("Due", selection: $dueAt)
                }
            }

            if let task, let onNotice, !task.isTerminal, task.assigneeType != "unassigned" {
                Section("Automation") {
                    Button {
                        prepareNotice(onNotice)
                    } label: {
                        Label("Prepare assignment notice", systemImage: "envelope.badge")
                    }
                    .disabled(isSaving || isPreparingNotice)
                    if let summary = task.notificationSummary {
                        Text(summary.assignmentLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.sandFestCoral)
                }
            }
        }
        .navigationTitle(task == nil ? "Delegate Task" : "Edit Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(task == nil ? "Create" : "Save") { save() }
                    .disabled(!canSave)
            }
        }
        .onChange(of: assigneeType) { _, _ in
            if assigneeType == "unassigned" {
                assigneeId = ""
            } else if !ownerOptions.contains(where: { $0.id == assigneeId }) {
                assigneeId = ownerOptions.first?.id ?? ""
            }
        }
    }

    @ViewBuilder
    private func taskOptions(_ values: [String]) -> some View {
        ForEach(values, id: \.self) { value in
            Text(statusLabel(value)).tag(value)
        }
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        errorMessage = nil
        let submission = StaffTaskSubmission(
            title: title,
            description: description,
            status: status,
            priority: priority,
            assigneeType: assigneeType,
            assigneeId: assigneeType == "unassigned" ? nil : assigneeId,
            dueAt: hasDueDate ? dueAt : nil
        )
        Task {
            let error = await onSave(submission)
            isSaving = false
            if let error {
                errorMessage = error
            } else {
                dismiss()
            }
        }
    }

    private func prepareNotice(_ action: @escaping () async -> String?) {
        isPreparingNotice = true
        errorMessage = nil
        Task {
            let error = await action()
            errorMessage = error
            isPreparingNotice = false
            if error == nil { dismiss() }
        }
    }
}

private func statusLabel(_ value: String) -> String {
    value.replacingOccurrences(of: "_", with: " ").capitalized
}
