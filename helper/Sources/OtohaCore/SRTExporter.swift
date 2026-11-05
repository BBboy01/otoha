import Foundation

public enum SRTExportMode: String, Codable, Sendable {
    case source
    case translation
    case bilingual
}

public enum SRTExporter {
    private struct CueKey: Hashable {
        let start: Int
        let end: Int
    }

    private struct Dialogue {
        let style: String
        let text: String
        let order: Int
        let key: CueKey
    }

    private struct Cue {
        let start: Int
        let end: Int
        let source: String
        let translation: String
        let order: Int
    }

    public static func export(_ ass: String, mode: SRTExportMode) throws -> String {
        let dialogues = try parseDialogues(ass)
        var grouped: [CueKey: (source: [Dialogue], translation: [Dialogue])] = [:]

        for dialogue in dialogues {
            let key = dialogue.key
            if dialogue.style.caseInsensitiveCompare("OtohaSource") == .orderedSame {
                grouped[key, default: ([], [])].source.append(dialogue)
            } else if dialogue.style.caseInsensitiveCompare("OtohaTranslation") == .orderedSame {
                grouped[key, default: ([], [])].translation.append(dialogue)
            }
        }

        guard !grouped.isEmpty else { throw SRTExportError.noSupportedCues }
        var cues = [Cue]()
        for (key, pair) in grouped {
            guard pair.source.count == pair.translation.count else { throw SRTExportError.unmatchedCue }
            for (source, translation) in zip(pair.source, pair.translation) {
                cues.append(Cue(
                    start: key.start,
                    end: key.end,
                    source: source.text,
                    translation: translation.text,
                    order: min(source.order, translation.order)
                ))
            }
        }
        cues.sort { $0.start == $1.start ? $0.order < $1.order : $0.start < $1.start }

        let blocks = cues.compactMap { cue -> String? in
            let text: String
            switch mode {
            case .source: text = cue.source
            case .translation: text = cue.translation
            case .bilingual: text = [cue.source, cue.translation].filter { !$0.isEmpty }.joined(separator: "\n")
            }
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return "\(timestamp(cue.start)) --> \(timestamp(cue.end))\n\(escapeHTML(text))"
        }
        guard !blocks.isEmpty else { throw SRTExportError.noUsableCues }
        return blocks.enumerated().map { "\($0.offset + 1)\n\($0.element)" }.joined(separator: "\n\n") + "\n\n"
    }

    private static func parseDialogues(_ ass: String) throws -> [Dialogue] {
        var columns: [String] = []
        var inEvents = false
        var dialogues = [Dialogue]()

        for (order, line) in ass.components(separatedBy: .newlines).enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") && trimmed.hasSuffix("]") {
                inEvents = trimmed.caseInsensitiveCompare("[Events]") == .orderedSame
                continue
            }
            guard inEvents else { continue }
            if trimmed.lowercased().hasPrefix("format:") {
                columns = trimmed.dropFirst("Format:".count).split(separator: ",").map {
                    $0.trimmingCharacters(in: .whitespaces).lowercased()
                }
                guard let start = columns.firstIndex(of: "start"),
                      let end = columns.firstIndex(of: "end"),
                      let style = columns.firstIndex(of: "style"),
                      let text = columns.firstIndex(of: "text"),
                      text == columns.count - 1,
                      start < columns.count, end < columns.count, style < columns.count else {
                    throw SRTExportError.invalidFormat
                }
                continue
            }
            guard trimmed.lowercased().hasPrefix("dialogue:") else { continue }
            guard !columns.isEmpty else { throw SRTExportError.invalidFormat }
            let fields = trimmed.dropFirst("Dialogue:".count)
                .split(separator: ",", maxSplits: columns.count - 1, omittingEmptySubsequences: false)
            guard fields.count == columns.count,
                  let startIndex = columns.firstIndex(of: "start"),
                  let endIndex = columns.firstIndex(of: "end"),
                  let styleIndex = columns.firstIndex(of: "style"),
                  let textIndex = columns.firstIndex(of: "text") else {
                throw SRTExportError.invalidDialogue
            }
            let start = try parseTimestamp(String(fields[startIndex]).trimmingCharacters(in: .whitespaces))
            let end = try parseTimestamp(String(fields[endIndex]).trimmingCharacters(in: .whitespaces))
            guard end > start else { throw SRTExportError.invalidTimeRange }
            dialogues.append(Dialogue(
                style: String(fields[styleIndex]).trimmingCharacters(in: .whitespaces),
                text: try plainText(String(fields[textIndex])),
                order: order,
                key: CueKey(start: start, end: end)
            ))
        }
        return dialogues
    }

    private static func parseTimestamp(_ value: String) throws -> Int {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let hours = Int(parts[0]),
              let minutes = Int(parts[1]),
              hours >= 0,
              hours <= (Int.max - 3_599_999) / 3_600_000,
              minutes >= 0,
              minutes < 60 else { throw SRTExportError.invalidTimestamp }
        let seconds = parts[2].split(separator: ".", omittingEmptySubsequences: false)
        guard seconds.count == 2,
              let wholeSeconds = Int(seconds[0]),
              wholeSeconds >= 0,
              wholeSeconds < 60,
              !seconds[1].isEmpty,
              seconds[1].allSatisfy({ $0 >= "0" && $0 <= "9" }),
              seconds[1].count <= 3 else { throw SRTExportError.invalidTimestamp }
        let milliseconds = Int(String(seconds[1]).padding(toLength: 3, withPad: "0", startingAt: 0))!
        return (((hours * 60 + minutes) * 60 + wholeSeconds) * 1000) + milliseconds
    }

    private static func plainText(_ value: String) throws -> String {
        let characters = Array(value)
        var result = ""
        var index = 0
        while index < characters.count {
            if characters[index] == "{" {
                guard let closingIndex = characters[(index + 1)...].firstIndex(of: "}") else {
                    throw SRTExportError.malformedOverride
                }
                index = closingIndex + 1
                continue
            }
            if characters[index] == "\\", index + 1 < characters.count {
                let next = characters[index + 1]
                switch next {
                case "N", "n": result.append("\n")
                case "h": result.append(" ")
                case "\\": result.append("\\")
                case "{", "}": result.append(next)
                default:
                    result.append("\\")
                    result.append(next)
                }
                index += 2
                continue
            }
            result.append(characters[index])
            index += 1
        }
        return result.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func timestamp(_ milliseconds: Int) -> String {
        let hours = milliseconds / 3_600_000
        let minutes = milliseconds / 60_000 % 60
        let seconds = milliseconds / 1000 % 60
        let millis = milliseconds % 1000
        return String(format: "%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
    }

    private static func escapeHTML(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

public enum SRTExportError: Error, Equatable, LocalizedError {
    case invalidFormat
    case invalidDialogue
    case invalidTimestamp
    case invalidTimeRange
    case malformedOverride
    case unmatchedCue
    case noSupportedCues
    case noUsableCues

    public var errorDescription: String? {
        switch self {
        case .invalidFormat, .invalidDialogue, .invalidTimestamp, .invalidTimeRange, .malformedOverride, .unmatchedCue:
            "字幕格式不完整或无法识别，请检查 ASS 文件。"
        case .noSupportedCues: "没有可导出的 Otoha 字幕片段。"
        case .noUsableCues: "所选内容没有可导出的字幕文本。"
        }
    }
}
