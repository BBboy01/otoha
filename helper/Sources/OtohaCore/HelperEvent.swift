import Foundation

public enum JobPhase: String, Codable, Sendable {
    case checkingEnvironment
    case preparingLanguageResources
    case extractingAudio
    case transcribing
    case translating
    case saving
    case loading
}

public struct HelperEvent: Codable, Sendable {
    public let type: String
    public let phase: String?
    public let message: String?
    public let progress: Double?
    public let path: String?

    private init(type: String, phase: String? = nil, message: String? = nil, progress: Double? = nil, path: String? = nil) {
        self.type = type
        self.phase = phase
        self.message = message
        self.progress = progress
        self.path = path
    }

    public static func phase(_ phase: JobPhase, message: String? = nil, progress: Double? = nil) -> Self {
        Self(type: "phase", phase: phase.rawValue, message: message, progress: progress)
    }

    public static func completed(path: URL) -> Self {
        Self(type: "completed", path: path.path)
    }

    public static func cancelled() -> Self {
        Self(type: "cancelled")
    }

    public static func failure(message: String) -> Self {
        Self(type: "error", message: message)
    }

    public func jsonLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

public typealias HelperEventPayload = HelperEvent
