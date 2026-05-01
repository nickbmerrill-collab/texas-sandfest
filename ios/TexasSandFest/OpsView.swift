import SwiftUI

struct OpsView: View {
    @State private var drafts: [IncidentDraft] = []
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Capture Incident") {
                    TextField("Notes", text: $notes, axis: .vertical)
                    Button("Create Lost Party Draft") {
                        drafts.append(IncidentDraft(
                            id: UUID(),
                            type: "lost_party",
                            zoneId: "north-gate",
                            severity: "medium",
                            notes: notes.isEmpty ? "Needs details" : notes,
                            createdAt: Date(),
                            syncedAt: nil
                        ))
                        notes = ""
                    }
                }

                Section("Draft Queue") {
                    if drafts.isEmpty {
                        Text("No offline drafts.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(drafts) { draft in
                            VStack(alignment: .leading) {
                                Text(draft.type.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.headline)
                                Text(draft.notes)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Ops")
        }
    }
}
