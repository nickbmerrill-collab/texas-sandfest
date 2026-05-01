import Foundation

/// Tracks which schedule item ids the visitor has starred. UserDefaults is the
/// right home for this — small, per-user, doesn't need server roundtrips.
@MainActor
final class FavoritesStore: ObservableObject {
    @Published private(set) var starred: Set<String>

    private let defaultsKey = "tsf.favorites.starred"
    private let defaults = UserDefaults.standard

    init() {
        if let data = defaults.array(forKey: defaultsKey) as? [String] {
            starred = Set(data)
        } else {
            starred = []
        }
    }

    func isStarred(_ id: String) -> Bool { starred.contains(id) }

    func toggle(_ id: String) {
        if starred.contains(id) {
            starred.remove(id)
        } else {
            starred.insert(id)
        }
        persist()
    }

    private func persist() {
        defaults.set(Array(starred), forKey: defaultsKey)
    }
}
