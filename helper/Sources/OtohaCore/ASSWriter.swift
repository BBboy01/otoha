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

public enum ASSWriter {
    public static func serialize(_ cues: [SubtitleCue], scale: Double = 1.0) throws -> String {
        guard scale.isFinite, (0.8...1.4).contains(scale) else { throw ASSError.invalidScale }
        let sorted = cues.sorted { $0.start < $1.start }
        guard !sorted.isEmpty else { throw ASSError.noCues }

        var lines = [
            "[Script Info]",
            "ScriptType: v4.00+",
            "PlayResX: 1920",
            "PlayResY: 1080",
            "WrapStyle: 2",
            "ScaledBorderAndShadow: yes",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            "Style: OtohaSource,Arial,\(fontSize(28, scale)),&H80FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,24,1",
            "Style: OtohaTranslation,Arial,\(fontSize(36, scale)),&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,10,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]

        for cue in sorted {
            guard cue.start.isFinite, cue.end.isFinite, cue.start >= 0, cue.end > cue.start else {
                throw ASSError.invalidTimeRange
            }
            let source = normalized(cue.source)
            let translation = normalized(cue.translation)
            guard !source.isEmpty, !translation.isEmpty else { throw ASSError.emptyText }

            let startTicks = timestampTicks(cue.start)
            let endTicks = max(startTicks + 1, timestampTicks(cue.end))
            let start = timestamp(startTicks)
            let end = timestamp(endTicks)
            lines.append("Dialogue: 0,\(start),\(end),OtohaTranslation,,0,0,0,,\(translation)")
            lines.append("Dialogue: 0,\(start),\(end),OtohaSource,,0,0,0,,\(source)")
        }

        return lines.joined(separator: "\n") + "\n"
    }

    private static func fontSize(_ base: Double, _ scale: Double) -> Int {
        Int((base * scale).rounded())
    }

    private static func normalized(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { escape(String($0)) }
            .joined(separator: "\\N")
    }

    private static func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "{", with: "\\{")
            .replacingOccurrences(of: "}", with: "\\}")
    }

    private static func timestampTicks(_ seconds: Double) -> Int64 {
        Int64((seconds * 100).rounded())
    }

    private static func timestamp(_ ticks: Int64) -> String {
        let hours = ticks / 360_000
        let minutes = (ticks % 360_000) / 6_000
        let seconds = (ticks % 6_000) / 100
        let centiseconds = ticks % 100
        return String(format: "%01lld:%02lld:%02lld.%02lld", hours, minutes, seconds, centiseconds)
    }
}

public enum ASSError: Error, Equatable, LocalizedError {
    case noCues
    case invalidTimeRange
    case emptyText
    case invalidScale

    public var errorDescription: String? {
        switch self {
        case .noCues: "没有识别到语音。"
        case .invalidTimeRange: "字幕片段的时间范围无效。"
        case .emptyText: "字幕片段缺少原文或译文。"
        case .invalidScale: "字幕字号比例无效。"
        }
    }
}
