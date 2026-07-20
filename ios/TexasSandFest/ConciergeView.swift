import SwiftUI

struct ConciergeView: View {
    @EnvironmentObject private var dataStore: AppDataStore
    @Binding var request: ConciergeRequest?
    let onOpenInternalSource: (String) -> Void

    @State private var question = ""
    @State private var messages: [ConciergeMessage] = [
        .intro("Ask about tickets, accessibility, parking, pets, volunteers, sponsors, vendors, or schedule changes.")
    ]
    @State private var isPending = false
    @FocusState private var questionFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                conversation
                composer
            }
            .background(Color.sandFestFoam.ignoresSafeArea())
            .navigationTitle("Ask Sandy")
            .task(id: request?.id) {
                await consumeRequest()
            }
        }
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(messages) { message in
                        messageView(message)
                            .id(message.id)
                    }
                    if isPending {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Checking current SandFest sources...")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        .padding(12)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding(.horizontal)
                .padding(.bottom)
                .padding(.top, 40)
            }
            .onChange(of: messages.count) { _, _ in
                guard let lastID = messages.last?.id else { return }
                withAnimation { proxy.scrollTo(lastID, anchor: .top) }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask Sandy...", text: $question, axis: .vertical)
                .lineLimit(1...3)
                .textFieldStyle(.roundedBorder)
                .focused($questionFocused)
                .disabled(isPending)
                .onSubmit {
                    Task { await submitQuestion(question) }
                }

            Button {
                Task { await submitQuestion(question) }
            } label: {
                Image(systemName: "paperplane.fill")
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.borderedProminent)
            .tint(.sandFestGulf)
            .disabled(isPending || question.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            .accessibilityLabel("Ask Sandy")
        }
        .padding()
        .background(.bar)
    }

    @ViewBuilder
    private func messageView(_ message: ConciergeMessage) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message.text)
                .font(.body)

            if let answer = message.answer {
                if answer.escalated {
                    Label("Confirm with SandFest staff", systemImage: "person.badge.shield.checkmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Color.sandFestCoral)
                }

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(answer.sources) { source in
                        sourceView(source)
                    }
                }

                if !answer.suggestions.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(answer.suggestions, id: \.self) { suggestion in
                            Button(suggestion) {
                                Task { await submitQuestion(suggestion) }
                            }
                            .buttonStyle(.bordered)
                            .tint(.sandFestGulf)
                            .disabled(isPending)
                        }
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(message.role == .user ? Color.sandFestGulf.opacity(0.14) : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.leading, message.role == .user ? 36 : 0)
        .padding(.trailing, message.role == .assistant ? 20 : 0)
    }

    @ViewBuilder
    private func sourceView(_ source: PublicConciergeSource) -> some View {
        if source.href.hasPrefix("#") {
            Button {
                onOpenInternalSource(source.href)
            } label: {
                Label(source.label, systemImage: "doc.text")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.sandFestGulf)
        } else if let url = URL(string: source.href) {
            Link(destination: url) {
                Label(source.label, systemImage: "arrow.up.right.square")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(Color.sandFestGulf)
        }
    }

    @MainActor
    private func consumeRequest() async {
        guard let pendingRequest = request else { return }
        request = nil

        guard let pendingQuestion = pendingRequest.question else {
            questionFocused = true
            return
        }
        question = pendingQuestion
        if pendingRequest.submitImmediately {
            await submitQuestion(pendingQuestion, refocus: false)
        } else {
            questionFocused = true
        }
    }

    @MainActor
    private func submitQuestion(_ questionInput: String, refocus: Bool = true) async {
        let submitted = questionInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isPending, (2...280).contains(submitted.count) else { return }

        question = ""
        messages.removeAll(where: \.isIntro)
        messages.append(.user(submitted))
        isPending = true
        defer {
            isPending = false
            questionFocused = refocus
        }

        do {
            let answer = try await dataStore.askSandy(submitted)
            messages.append(.assistant(answer))
        } catch {
            let contact = [dataStore.payload.guide.email, dataStore.payload.guide.phone]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: " or ")
            let fallback = contact.isEmpty
                ? "Ask Sandy cannot reach current sources right now. Please contact SandFest staff."
                : "Ask Sandy cannot reach current sources right now. Contact \(contact)."
            messages.append(.assistant(fallback))
        }
    }
}

private struct ConciergeMessage: Identifiable {
    enum Role {
        case user
        case assistant
    }

    let id = UUID()
    let role: Role
    let text: String
    let answer: PublicConciergeResponse?
    let isIntro: Bool

    static func user(_ text: String) -> ConciergeMessage {
        ConciergeMessage(role: .user, text: text, answer: nil, isIntro: false)
    }

    static func intro(_ text: String) -> ConciergeMessage {
        ConciergeMessage(role: .assistant, text: text, answer: nil, isIntro: true)
    }

    static func assistant(_ text: String) -> ConciergeMessage {
        ConciergeMessage(role: .assistant, text: text, answer: nil, isIntro: false)
    }

    static func assistant(_ answer: PublicConciergeResponse) -> ConciergeMessage {
        ConciergeMessage(role: .assistant, text: answer.answer, answer: answer, isIntro: false)
    }
}
