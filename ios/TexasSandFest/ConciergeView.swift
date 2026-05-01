import SwiftUI

struct ConciergeView: View {
    @State private var question = ""
    @State private var messages = [
        "Ask me about tickets, accessibility, parking, pets, volunteers, sponsors, vendors, or schedule changes."
    ]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(messages, id: \.self) { message in
                            Text(message)
                                .padding(12)
                                .background(Color.white)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding()
                }

                HStack {
                    TextField("Ask Sandy...", text: $question)
                        .textFieldStyle(.roundedBorder)
                    Button("Ask") {
                        guard !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                        messages.append(question)
                        messages.append(answer(for: question))
                        question = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.sandFestGulf)
                }
                .padding()
                .background(.bar)
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Ask Sandy")
        }
    }

    private func answer(for question: String) -> String {
        let lower = question.lowercased()
        if lower.contains("ios") || lower.contains("app") {
            return "First iOS release: offline guide, map, schedule, push alerts, Ask Sandy, volunteer check-in, and incident drafts."
        }
        if lower.contains("parking") || lower.contains("ada") {
            return "Use the canonical accessibility and parking records. High-risk or accommodation-specific questions should route to Guest Relations."
        }
        return "Production Sandy will answer from approved source records, cite the source, and escalate uncertain questions to staff."
    }
}
