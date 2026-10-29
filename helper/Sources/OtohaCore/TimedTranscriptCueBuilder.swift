import Foundation

public struct TimedTranscriptToken: Equatable, Sendable {
    public let text: String
    public let start: Double?
    public let end: Double?

    public init(text: String, start: Double? = nil, end: Double? = nil) {
        self.text = text
        self.start = start
        self.end = end
    }
}

public struct TimedTranscriptCue: Equatable, Sendable {
    public let start: Double
    public let end: Double
    public let text: String

    public init(start: Double, end: Double, text: String) {
        self.start = start
        self.end = end
        self.text = text
    }
}

public enum TimedTranscriptCueBuilder {
    public static func build(
        tokens: [TimedTranscriptToken],
        fallbackStart: Double,
        fallbackEnd: Double,
        maxDuration: Double = 4,
        maxCharacters: Int = 48
    ) -> [TimedTranscriptCue] {
        let start = max(0, fallbackStart.isFinite ? fallbackStart : 0)
        let end = max(start + 0.05, fallbackEnd.isFinite ? fallbackEnd : start + 0.05)
        let text = tokens.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [] }
        guard tokens.contains(where: hasTiming) else {
            return splitUntimed(text, start: start, end: end, maxCharacters: maxCharacters)
        }

        var cues: [TimedTranscriptCue] = []
        var buffer = ""
        var cueStart: Double?
        var cueEnd: Double?

        func flush() {
            let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return }
            let resolvedStart = max(start, cueStart ?? start)
            let resolvedEnd = max(resolvedStart + 0.05, cueEnd ?? end)
            cues.append(TimedTranscriptCue(start: resolvedStart, end: resolvedEnd, text: value))
            buffer = ""
            cueStart = nil
            cueEnd = nil
        }

        for token in tokens where !token.text.isEmpty {
            buffer += token.text
            if let tokenStart = validTime(token.start), cueStart == nil { cueStart = tokenStart }
            if let tokenEnd = validTime(token.end) { cueEnd = tokenEnd }

            let value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
            let duration = (cueEnd ?? end) - (cueStart ?? start)
            if shouldSplit(value: value, fragment: token.text, duration: duration, maxDuration: maxDuration, maxCharacters: maxCharacters) {
                flush()
            }
        }
        flush()
        return cues
    }

    private static func hasTiming(_ token: TimedTranscriptToken) -> Bool {
        validTime(token.start) != nil && validTime(token.end) != nil
    }

    private static func validTime(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }

    private static func shouldSplit(value: String, fragment: String, duration: Double, maxDuration: Double, maxCharacters: Int) -> Bool {
        guard !value.isEmpty else { return false }
        let punctuation = fragment.contains { ".!?。！？；;".contains($0) }
        return punctuation || duration >= maxDuration || value.count >= maxCharacters
    }

    private static func splitUntimed(_ text: String, start: Double, end: Double, maxCharacters: Int) -> [TimedTranscriptCue] {
        var chunks: [String] = []
        var buffer = ""
        for character in text {
            buffer.append(character)
            let punctuation = ".!?。！？；;".contains(character)
            if punctuation || buffer.count >= maxCharacters {
                chunks.append(buffer.trimmingCharacters(in: .whitespacesAndNewlines))
                buffer = ""
            }
        }
        if !buffer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            chunks.append(buffer.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        let totalCharacters = max(1, chunks.reduce(0) { $0 + $1.count })
        let duration = end - start
        var cursor = start
        return chunks.enumerated().map { index, chunk in
            let portion = index == chunks.count - 1 ? end - cursor : duration * Double(chunk.count) / Double(totalCharacters)
            let cueEnd = max(cursor + 0.05, cursor + portion)
            defer { cursor = cueEnd }
            return TimedTranscriptCue(start: cursor, end: cueEnd, text: chunk)
        }
    }
}
