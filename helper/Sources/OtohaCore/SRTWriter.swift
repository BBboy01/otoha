import Foundation

public struct SubtitleCue: Equatable, Sendable {
    public let start: Double
    public let end: Double
    public let source: String
    public let translation: String

    public init(start: Double, end: Double, source: String, translation: String) {
        self.start = start
        self.end = end
        self.source = source
        self.translation = translation
    }
}

public enum SRTWriter {
    public static func serialize(_ cues: [SubtitleCue]) throws -> String {
        let sorted = cues.sorted { $0.start < $1.start }
        guard !sorted.isEmpty else { throw SRTError.noCues }

        let blocks = try sorted.enumerated().map { index, cue in
            guard cue.start.isFinite, cue.end.isFinite, cue.start >= 0, cue.end > cue.start else {
                throw SRTError.invalidTimeRange
            }
            let source = normalized(cue.source)
            let translation = normalized(cue.translation)
            guard !source.isEmpty, !translation.isEmpty else { throw SRTError.emptyText }
            return "\(index + 1)\n\(timestamp(cue.start)) --> \(timestamp(cue.end))\n\(source)\n\(translation)"
        }
        return blocks.joined(separator: "\n\n") + "\n"
    }

    private static func normalized(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func timestamp(_ seconds: Double) -> String {
        let milliseconds = Int64((seconds * 1_000).rounded())
        let hours = milliseconds / 3_600_000
        let minutes = (milliseconds % 3_600_000) / 60_000
        let seconds = (milliseconds % 60_000) / 1_000
        let remainder = milliseconds % 1_000
        return String(format: "%02lld:%02lld:%02lld,%03lld", hours, minutes, seconds, remainder)
    }
}

public enum SRTError: Error, Equatable, LocalizedError {
    case noCues
    case invalidTimeRange
    case emptyText

    public var errorDescription: String? {
        switch self {
        case .noCues: "没有识别到语音。"
        case .invalidTimeRange: "字幕片段的时间范围无效。"
        case .emptyText: "字幕片段缺少原文或译文。"
        }
    }
}
