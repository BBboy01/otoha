import Foundation

public enum HelperLaunchMode: Equatable, Sendable {
    case background
    case debugUI

    public init(arguments: [String]) {
        self = arguments.contains("--ui") ? .debugUI : .background
    }
}
