import Foundation
import SwiftUI

struct IncidentDashboardPayload: Decodable {
    let lastUpdated: String?
    let summary: IncidentDashboardSummary
    let incidents: [OperationsIncident]
    let dispatches: [IncidentDispatch]
    let assignmentDirectory: IncidentAssignmentDirectory
}

struct IncidentDashboardSummary: Decodable {
    let activeIncidents: Int
}

struct OperationsIncident: Identifiable, Codable, Equatable {
    let id: String
    var title: String
    var summary: String
    var severity: String
    var status: String
    var ownerTeam: String
    var ownerName: String?
    var publicImpact: Bool
    var publicAlertRecommended: Bool
    var createdAt: String
    var updatedAt: String
    var resolution: String?

    var isClosed: Bool {
        status == "resolved" || status == "dismissed"
    }

    var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }

    var severityLabel: String {
        severity.capitalized
    }

    var ownerLabel: String {
        ownerName ?? ownerTeam.replacingOccurrences(of: "-", with: " ").capitalized
    }
}

struct IncidentDispatch: Identifiable, Codable, Equatable {
    let id: String
    let incidentId: String
    var title: String
    var instructions: String
    var status: String
    var priority: String
    var assigneeType: String
    var assigneeId: String
    var assigneeName: String
    var dueAt: String?
    var notification: IncidentDispatchNotification

    var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct IncidentDispatchNotification: Codable, Equatable {
    var channel: String
    var status: String
    var recipientAvailable: Bool?

    var statusLabel: String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

struct IncidentAssignmentDirectory: Decodable, Equatable {
    let teams: [IncidentAssignmentTeam]
}

struct IncidentAssignmentTeam: Identifiable, Decodable, Equatable {
    let id: String
    let name: String
    let notificationReady: Bool
}

private struct IncidentMutationPayload: Decodable {
    let incident: OperationsIncident?
    let dispatch: IncidentDispatch?
}

private struct IncidentAPIError: Decodable {
    let error: String
}

@MainActor
final class IncidentStore: ObservableObject {
    @Published private(set) var incidents: [OperationsIncident] = []
    @Published private(set) var dispatches: [IncidentDispatch] = []
    @Published private(set) var teams: [IncidentAssignmentTeam] = []
    @Published private(set) var source = "Board session required"
    @Published var lastError: String?

    private let transport: AppDataTransport

    init(transport: AppDataTransport = .live) {
        self.transport = transport
    }

    var activeIncidents: [OperationsIncident] {
        incidents
            .filter { !$0.isClosed }
            .sorted { severityRank($0.severity) > severityRank($1.severity) }
    }

    var recentClosedIncidents: [OperationsIncident] {
        Array(incidents.filter(\.isClosed).sorted { $0.updatedAt > $1.updatedAt }.prefix(3))
    }

    var criticalCount: Int {
        activeIncidents.filter { $0.severity == "critical" }.count
    }

    var activeDispatchCount: Int {
        let closed = Set(["completed", "canceled"])
        return dispatches.filter { !closed.contains($0.status) }.count
    }

    func incident(id: String) -> OperationsIncident? {
        incidents.first { $0.id == id }
    }

    func dispatches(for incidentId: String) -> [IncidentDispatch] {
        dispatches.filter { $0.incidentId == incidentId }
    }

    func refresh(request: URLRequest?) async {
        guard let request else {
            source = "Board session required"
            lastError = "Authenticated board incident access is unavailable."
            return
        }
        do {
            let response = try await transport.load(request)
            guard response.statusCode == 200 else {
                lastError = apiError(from: response.data) ?? "Incident API \(response.statusCode)"
                return
            }
            let payload = try JSONDecoder().decode(IncidentDashboardPayload.self, from: response.data)
            incidents = payload.incidents
            dispatches = payload.dispatches
            teams = payload.assignmentDirectory.teams
            source = "Live board incidents"
            lastError = nil
        } catch {
            lastError = "Incident refresh failed. Existing incident data was not changed."
        }
    }

    func createIncident(
        title: String,
        summary: String,
        severity: String,
        ownerTeam: String,
        publicImpact: Bool,
        request: URLRequest?
    ) async -> String? {
        let result = await send(
            request: request,
            body: [
                "title": title,
                "summary": summary,
                "severity": severity,
                "ownerTeam": ownerTeam,
                "publicImpact": publicImpact,
                "publicAlertRecommended": publicImpact && ["high", "critical"].contains(severity),
                "note": "Created from the native incident command screen."
            ],
            acceptedStatusCodes: [200, 201]
        )
        guard let data = result.data else { return result.error }
        do {
            let payload = try JSONDecoder().decode(IncidentMutationPayload.self, from: data)
            guard let incident = payload.incident else {
                return "Incident API returned no incident; local state was not changed."
            }
            upsert(incident)
            markLive()
            return nil
        } catch {
            return "Incident response was invalid; local state was not changed."
        }
    }

    func updateIncident(
        id: String,
        status: String,
        severity: String,
        ownerTeam: String,
        note: String,
        request: URLRequest?,
        refreshRequest: URLRequest? = nil
    ) async -> String? {
        var body: [String: Any] = [
            "status": status,
            "severity": severity,
            "ownerTeam": ownerTeam
        ]
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedNote.isEmpty { body["note"] = trimmedNote }
        if ["resolved", "dismissed"].contains(status) { body["resolution"] = trimmedNote }
        let result = await send(request: request, body: body, acceptedStatusCodes: [200])
        guard let data = result.data else { return result.error }
        do {
            let payload = try JSONDecoder().decode(IncidentMutationPayload.self, from: data)
            guard let incident = payload.incident else {
                return "Incident API returned no incident; local state was not changed."
            }
            upsert(incident)
            markLive()
            if let refreshRequest { await refresh(request: refreshRequest) }
            return nil
        } catch {
            return "Incident response was invalid; local state was not changed."
        }
    }

    func createDispatch(
        incidentId: String,
        teamId: String,
        instructions: String,
        prepareEmailDraft: Bool,
        request: URLRequest?
    ) async -> String? {
        let result = await send(
            request: request,
            body: [
                "assigneeType": "team",
                "assigneeId": teamId,
                "instructions": instructions,
                "channel": prepareEmailDraft ? "email" : "none"
            ],
            acceptedStatusCodes: [200, 201]
        )
        guard let data = result.data else { return result.error }
        do {
            let payload = try JSONDecoder().decode(IncidentMutationPayload.self, from: data)
            guard let dispatch = payload.dispatch, let incident = payload.incident else {
                return "Dispatch API returned incomplete data; local state was not changed."
            }
            upsert(incident)
            upsert(dispatch)
            markLive()
            return nil
        } catch {
            return "Dispatch response was invalid; local state was not changed."
        }
    }

    private func send(
        request inputRequest: URLRequest?,
        body: [String: Any],
        acceptedStatusCodes: Set<Int>
    ) async -> (data: Data?, error: String?) {
        guard var request = inputRequest else {
            return (nil, "Authenticated board incident access is unavailable; no incident state was changed.")
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let response = try await transport.load(request)
            guard acceptedStatusCodes.contains(response.statusCode) else {
                return (nil, apiError(from: response.data) ?? "Incident API \(response.statusCode); no incident state was changed.")
            }
            return (response.data, nil)
        } catch {
            return (nil, "Incident request failed; no incident state was changed.")
        }
    }

    private func apiError(from data: Data) -> String? {
        try? JSONDecoder().decode(IncidentAPIError.self, from: data).error
    }

    private func upsert(_ incident: OperationsIncident) {
        if let index = incidents.firstIndex(where: { $0.id == incident.id }) {
            incidents[index] = incident
        } else {
            incidents.append(incident)
        }
    }

    private func upsert(_ dispatch: IncidentDispatch) {
        if let index = dispatches.firstIndex(where: { $0.id == dispatch.id }) {
            dispatches[index] = dispatch
        } else {
            dispatches.append(dispatch)
        }
    }

    private func markLive() {
        source = "Live board incidents"
        lastError = nil
    }

    private func severityRank(_ value: String) -> Int {
        ["low", "moderate", "high", "critical"].firstIndex(of: value) ?? 0
    }
}

struct OpsView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @StateObject private var store = IncidentStore()
    @State private var showingCreate = false
    @State private var selectedIncident: OperationsIncident?
    @State private var statusNote: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label(
                        store.source,
                        systemImage: store.source == "Live board incidents" ? "checkmark.circle.fill" : "lock.fill"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(store.source == "Live board incidents" ? Color.sandFestGulf : .secondary)

                    HStack(spacing: 10) {
                        kpi("Active", store.activeIncidents.count, color: .sandFestGulf)
                        kpi("Critical", store.criticalCount, color: .sandFestCoral)
                        kpi("Dispatches", store.activeDispatchCount, color: .sandFestSun)
                    }

                    if let statusNote {
                        Text(statusNote)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 4)
                    }
                    if let lastError = store.lastError {
                        Label(lastError, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.sandFestCoral)
                            .padding(.horizontal, 4)
                    }

                    incidentSection(
                        title: "Active incidents",
                        incidents: store.activeIncidents,
                        emptyMessage: "The shared board incident ledger is clear."
                    )

                    if !store.recentClosedIncidents.isEmpty {
                        incidentSection(
                            title: "Recent closeout",
                            incidents: store.recentClosedIncidents,
                            emptyMessage: ""
                        )
                    }
                }
                .padding(16)
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Incidents")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh incidents")

                    Button {
                        showingCreate = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("Create incident")
                    .disabled(!canManageIncidents)
                }
            }
            .sheet(isPresented: $showingCreate) {
                IncidentCreateSheet(store: store) { title in
                    statusNote = "Created \(title) in the shared incident ledger."
                }
                .environmentObject(dataStore)
            }
            .sheet(item: $selectedIncident) { incident in
                IncidentDetailSheet(store: store, incidentId: incident.id) { message in
                    statusNote = message
                }
                .environmentObject(dataStore)
            }
            .task { await refresh() }
        }
    }

    private var canManageIncidents: Bool {
        dataStore.makeBoardAdminRequest(
            path: "/api/admin/island-conditions/incidents",
            method: "POST"
        ) != nil
    }

    private func refresh() async {
        await store.refresh(
            request: dataStore.makeBoardAdminRequest(path: "/api/admin/island-conditions")
        )
    }

    @ViewBuilder
    private func incidentSection(title: String, incidents: [OperationsIncident], emptyMessage: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Color.sandFestDeep)
            if incidents.isEmpty {
                Panel {
                    Label(emptyMessage, systemImage: "checkmark.shield.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.sandFestGulf)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                ForEach(incidents) { incident in
                    Button {
                        selectedIncident = incident
                    } label: {
                        IncidentCard(
                            incident: incident,
                            dispatchCount: store.dispatches(for: incident.id).count
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func kpi(_ label: String, _ value: Int, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text("\(value)")
                .font(.title2.weight(.black))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity, minHeight: 70, alignment: .leading)
        .padding(12)
        .background(Color.white.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct IncidentCard: View {
    let incident: OperationsIncident
    let dispatchCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: incident.isClosed ? "checkmark.shield.fill" : "exclamationmark.triangle.fill")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(severityColor)
                    .frame(width: 34, height: 34)
                    .background(severityColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 4) {
                    Text(incident.title)
                        .font(.headline)
                        .foregroundStyle(Color.sandFestDeep)
                        .multilineTextAlignment(.leading)
                    Text(incident.summary.isEmpty ? "No incident summary" : incident.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 4)
                Text(incident.severityLabel)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(severityColor)
            }

            HStack(spacing: 12) {
                Label(incident.statusLabel, systemImage: "waveform.path.ecg")
                Label(incident.ownerLabel, systemImage: "person.2.fill")
                if dispatchCount > 0 {
                    Label("\(dispatchCount)", systemImage: "paperplane.fill")
                }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var severityColor: Color {
        switch incident.severity {
        case "critical": .sandFestCoral
        case "high": .orange
        case "moderate": .sandFestSun
        default: .sandFestGulf
        }
    }
}

private struct IncidentCreateSheet: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: IncidentStore
    let onCreated: (String) -> Void

    @State private var title = ""
    @State private var summary = ""
    @State private var severity = "moderate"
    @State private var ownerTeam = "operations"
    @State private var publicImpact = false
    @State private var errorMessage: String?
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Incident") {
                    TextField("Title", text: $title)
                    TextField("What is happening", text: $summary, axis: .vertical)
                        .lineLimit(3...6)
                    Picker("Severity", selection: $severity) {
                        ForEach(IncidentOptions.severities, id: \.self) { value in
                            Text(value.capitalized).tag(value)
                        }
                    }
                    Picker("Owner team", selection: $ownerTeam) {
                        ForEach(ownerTeamOptions) { team in
                            Text(team.name).tag(team.id)
                        }
                    }
                    Toggle("Public impact", isOn: $publicImpact)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.sandFestCoral)
                    }
                }
            }
            .navigationTitle("New Incident")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { submit() }
                        .disabled(submitting || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !canManage)
                }
            }
        }
    }

    private var ownerTeamOptions: [IncidentAssignmentTeam] {
        IncidentOptions.ownerTeams(adding: store.teams)
    }

    private var canManage: Bool {
        dataStore.makeBoardAdminRequest(
            path: "/api/admin/island-conditions/incidents",
            method: "POST"
        ) != nil
    }

    private func submit() {
        let submittedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        submitting = true
        errorMessage = nil
        Task {
            let error = await store.createIncident(
                title: submittedTitle,
                summary: summary.trimmingCharacters(in: .whitespacesAndNewlines),
                severity: severity,
                ownerTeam: ownerTeam,
                publicImpact: publicImpact,
                request: dataStore.makeBoardAdminRequest(
                    path: "/api/admin/island-conditions/incidents",
                    method: "POST"
                )
            )
            submitting = false
            if let error {
                errorMessage = error
            } else {
                onCreated(submittedTitle)
                dismiss()
            }
        }
    }
}

private struct IncidentDetailSheet: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: IncidentStore
    let incidentId: String
    let onChanged: (String) -> Void

    @State private var status = "open"
    @State private var severity = "moderate"
    @State private var ownerTeam = "operations"
    @State private var note = ""
    @State private var dispatchTeam = "operations"
    @State private var instructions = ""
    @State private var prepareEmailDraft = true
    @State private var errorMessage: String?
    @State private var submitting = false

    private var incident: OperationsIncident? {
        store.incident(id: incidentId)
    }

    var body: some View {
        NavigationStack {
            Form {
                if let incident {
                    Section("Incident") {
                        LabeledContent("Severity", value: incident.severityLabel)
                        LabeledContent("Status", value: incident.statusLabel)
                        LabeledContent("Owner", value: incident.ownerLabel)
                        if !incident.summary.isEmpty { Text(incident.summary) }
                        if incident.publicImpact {
                            Label("Public impact", systemImage: "person.3.fill")
                                .foregroundStyle(Color.sandFestCoral)
                        }
                    }

                    if !incident.isClosed {
                        Section("Command update") {
                            Picker("Status", selection: $status) {
                                ForEach(IncidentOptions.statuses, id: \.self) { value in
                                    Text(IncidentOptions.label(value)).tag(value)
                                }
                            }
                            Picker("Severity", selection: $severity) {
                                ForEach(IncidentOptions.severities, id: \.self) { value in
                                    Text(value.capitalized).tag(value)
                                }
                            }
                            Picker("Owner team", selection: $ownerTeam) {
                                ForEach(ownerTeamOptions) { team in
                                    Text(team.name).tag(team.id)
                                }
                            }
                            TextField(closeoutRequired ? "Resolution note" : "Command note", text: $note, axis: .vertical)
                                .lineLimit(2...5)
                            Button("Save command update") { saveUpdate() }
                                .disabled(submitting || !canManage || (closeoutRequired && note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                        }

                        Section("Responder dispatch") {
                            Picker("Team", selection: $dispatchTeam) {
                                ForEach(availableTeams) { team in
                                    Text(team.name).tag(team.id)
                                }
                            }
                            TextField("Instructions", text: $instructions, axis: .vertical)
                                .lineLimit(2...5)
                            Toggle("Prepare email draft", isOn: $prepareEmailDraft)
                            Button("Create dispatch") { createDispatch() }
                                .disabled(submitting || !canManage || availableTeams.isEmpty)
                        }
                    }

                    let dispatches = store.dispatches(for: incident.id)
                    if !dispatches.isEmpty {
                        Section("Dispatches") {
                            ForEach(dispatches) { dispatch in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(dispatch.assigneeName)
                                        .font(.headline)
                                    Text("\(dispatch.statusLabel) · \(dispatch.notification.statusLabel)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if !dispatch.instructions.isEmpty {
                                        Text(dispatch.instructions)
                                            .font(.subheadline)
                                    }
                                }
                            }
                        }
                    }

                    if let resolution = incident.resolution {
                        Section("Resolution") { Text(resolution) }
                    }
                } else {
                    Section {
                        Label("Incident no longer exists in the shared ledger.", systemImage: "exclamationmark.triangle.fill")
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(Color.sandFestCoral)
                    }
                }
            }
            .navigationTitle(incident?.title ?? "Incident")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .onAppear { syncFields() }
        }
    }

    private var availableTeams: [IncidentAssignmentTeam] {
        store.teams.isEmpty
            ? [IncidentAssignmentTeam(id: "operations", name: "Operations team", notificationReady: false)]
            : store.teams
    }

    private var closeoutRequired: Bool {
        status == "resolved" || status == "dismissed"
    }

    private var ownerTeamOptions: [IncidentAssignmentTeam] {
        IncidentOptions.ownerTeams(adding: store.teams)
    }

    private var canManage: Bool {
        guard let incident else { return false }
        return dataStore.makeBoardAdminRequest(
            path: "/api/admin/island-conditions/incidents/\(incident.id)",
            method: "PATCH"
        ) != nil
    }

    private func syncFields() {
        guard let incident else { return }
        status = incident.status
        severity = incident.severity
        ownerTeam = incident.ownerTeam
        dispatchTeam = availableTeams.first?.id ?? "operations"
    }

    private func saveUpdate() {
        guard let incident else { return }
        submitting = true
        errorMessage = nil
        Task {
            let error = await store.updateIncident(
                id: incident.id,
                status: status,
                severity: severity,
                ownerTeam: ownerTeam,
                note: note,
                request: dataStore.makeBoardAdminRequest(
                    path: "/api/admin/island-conditions/incidents/\(incident.id)",
                    method: "PATCH"
                ),
                refreshRequest: dataStore.makeBoardAdminRequest(path: "/api/admin/island-conditions")
            )
            submitting = false
            if let error {
                errorMessage = error
            } else {
                note = ""
                onChanged("Updated \(incident.title) in the shared incident ledger.")
                syncFields()
            }
        }
    }

    private func createDispatch() {
        guard let incident else { return }
        submitting = true
        errorMessage = nil
        Task {
            let error = await store.createDispatch(
                incidentId: incident.id,
                teamId: dispatchTeam,
                instructions: instructions.trimmingCharacters(in: .whitespacesAndNewlines),
                prepareEmailDraft: prepareEmailDraft,
                request: dataStore.makeBoardAdminRequest(
                    path: "/api/admin/island-conditions/incidents/\(incident.id)/dispatches",
                    method: "POST"
                )
            )
            submitting = false
            if let error {
                errorMessage = error
            } else {
                instructions = ""
                onChanged("Created a responder dispatch for \(incident.title).")
            }
        }
    }
}

private enum IncidentOptions {
    static let severities = ["low", "moderate", "high", "critical"]
    static let statuses = ["open", "acknowledged", "responding", "monitoring", "resolved", "dismissed"]
    static let canonicalOwnerTeams = [
        IncidentAssignmentTeam(id: "operations", name: "Operations team", notificationReady: false),
        IncidentAssignmentTeam(id: "traffic", name: "Traffic and parking", notificationReady: false),
        IncidentAssignmentTeam(id: "guest-services", name: "Guest services", notificationReady: false),
        IncidentAssignmentTeam(id: "safety", name: "Safety", notificationReady: false),
        IncidentAssignmentTeam(id: "medical", name: "Medical", notificationReady: false),
        IncidentAssignmentTeam(id: "security", name: "Security", notificationReady: false),
        IncidentAssignmentTeam(id: "production", name: "Production team", notificationReady: false),
        IncidentAssignmentTeam(id: "volunteer-captains", name: "Volunteer captains", notificationReady: false)
    ]

    static func ownerTeams(adding remote: [IncidentAssignmentTeam]) -> [IncidentAssignmentTeam] {
        remote + canonicalOwnerTeams.filter { candidate in
            !remote.contains { $0.id == candidate.id }
        }
    }

    static func label(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

#Preview {
    OpsView()
        .environmentObject(AppDataStore())
}
