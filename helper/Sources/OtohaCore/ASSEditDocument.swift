import Foundation

public struct ASSEditText: Codable, Sendable {
    public let source: String
    public let translation: String
    public init(source: String, translation: String) { self.source = source; self.translation = translation }
}

public struct ASSEditCue: Codable, Sendable {
    public let start: Double
    public let end: Double
    public let source: String
    public let translation: String
}

public struct ASSEditDocument {
    private struct Event {
        let line: Int
        let prefix: String
        let fields: [String]
        let textIndex: Int
        let text: String
        let start: Double
        let end: Double
        let style: String
        let left: Double?
        let right: Double?
        var key: String { "\(start):\(end)" }
    }
    private let lines: [String]
    private let newline: String
    private let pairs: [(source: Event, translation: Event)]
    private let layout: ASSEditLayout
    public let cues: [ASSEditCue]

    public init(_ content: String) throws {
        newline = content.contains("\r\n") ? "\r\n" : "\n"
        lines = content.components(separatedBy: newline)
        layout = try ASSEditLayout(lines: lines)
        var inEvents = false
        var format: [String] = []
        var events: [Event] = []
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") { inEvents = trimmed.lowercased() == "[events]"; continue }
            guard inEvents, let colon = line.firstIndex(of: ":") else { continue }
            let kind = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let body = String(line[line.index(after: colon)...])
            if kind == "format" {
                format = body.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                continue
            }
            guard kind == "dialogue" else { continue }
            guard format.last == "text", Set(format).count == format.count,
                  let styleIndex = format.firstIndex(of: "style"), let startIndex = format.firstIndex(of: "start"),
                  let endIndex = format.firstIndex(of: "end") else { throw ASSEditError.invalidDocument }
            let fields = body.split(separator: ",", maxSplits: format.count - 1, omittingEmptySubsequences: false).map(String.init)
            guard fields.count == format.count else { throw ASSEditError.invalidDocument }
            let style = fields[styleIndex].trimmingCharacters(in: .whitespaces)
            guard ["OtohaSource", "OtohaTranslation"].contains(style) else { continue }
            let start = try Self.time(fields[startIndex]), end = try Self.time(fields[endIndex])
            guard end > start else { throw ASSEditError.invalidDocument }
            events.append(Event(line: index, prefix: String(line[...colon]), fields: fields,
                textIndex: format.count - 1, text: try Self.decodeText(fields[format.count - 1]),
                start: start, end: end, style: style,
                left: format.firstIndex(of: "marginl").flatMap { Double(fields[$0]) },
                right: format.firstIndex(of: "marginr").flatMap { Double(fields[$0]) }))
        }
        var translations: [String: [Event]] = [:]
        for event in events where event.style == "OtohaTranslation" { translations[event.key, default: []].append(event) }
        var consumed: [String: Int] = [:]
        var paired: [(source: Event, translation: Event)] = []
        for source in events where source.style == "OtohaSource" {
            let offset = consumed[source.key, default: 0]
            guard let matches = translations[source.key], offset < matches.count else { throw ASSEditError.invalidDocument }
            paired.append((source, matches[offset])); consumed[source.key] = offset + 1
        }
        guard !paired.isEmpty, paired.count * 2 == events.count else { throw ASSEditError.invalidDocument }
        pairs = paired
        cues = paired.map { ASSEditCue(start: $0.source.start, end: $0.source.end, source: $0.source.text, translation: $0.translation.text) }
    }

    public func replacingTexts(_ texts: [ASSEditText], forceRewrap: Bool = false) throws -> String {
        guard texts.count == pairs.count else { throw ASSEditError.invalidEdits }
        var result = lines
        var layout = layout
        for (pair, text) in zip(pairs, texts) {
            for (event, value) in [(pair.source, text.source), (pair.translation, text.translation)] {
                guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      !value.unicodeScalars.contains(where: { $0.value == 0 }) else { throw ASSEditError.invalidEdits }
                if value == event.text && !forceRewrap { continue }
                var fields = event.fields
                fields[event.textIndex] = Self.encodeText(layout.wrapped(value, style: event.style, left: event.left, right: event.right))
                result[event.line] = event.prefix + fields.joined(separator: ",")
            }
        }
        return result.joined(separator: newline)
    }

    private static func time(_ text: String) throws -> Double {
        let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 3, let hours = Int(parts[0]), hours >= 0,
              let minutes = Int(parts[1]), (0..<60).contains(minutes),
              let seconds = Double(parts[2]), seconds.isFinite, (0..<60).contains(seconds) else { throw ASSEditError.invalidDocument }
        let value = Double(hours) * 3600 + Double(minutes) * 60 + seconds
        guard value.isFinite else { throw ASSEditError.invalidDocument }
        return value
    }

    private static func decodeText(_ text: String) throws -> String {
        var result = "", escaped = false
        for character in text {
            if escaped {
                switch character {
                case "N", "n": result.append("\n")
                case "\\", "{", "}": result.append(character)
                case "h": result.append("\u{00A0}")
                default: throw ASSEditError.invalidDocument
                }
                escaped = false
            } else if character == "\\" { escaped = true }
            else if character == "{" || character == "}" { throw ASSEditError.invalidDocument }
            else { result.append(character) }
        }
        guard !escaped else { throw ASSEditError.invalidDocument }
        return result
    }

    private static func encodeText(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "{", with: "\\{").replacingOccurrences(of: "}", with: "\\}")
            .replacingOccurrences(of: "\n", with: "\\N")
    }
}

public enum ASSEditError: Error, LocalizedError {
    case invalidDocument, invalidEdits, outsideLibrary, conflict, tooLarge
    public var code: String {
        switch self {
        case .invalidDocument: HelperErrorCode.subtitleEditUnsupported.rawValue
        case .invalidEdits: HelperErrorCode.subtitleEditInvalidText.rawValue
        case .outsideLibrary: HelperErrorCode.subtitleEditOutsideLibrary.rawValue
        case .conflict: HelperErrorCode.subtitleEditConflict.rawValue
        case .tooLarge: HelperErrorCode.subtitleEditTooLarge.rawValue
        }
    }
    public var errorDescription: String? {
        switch self {
        case .invalidDocument: "这份字幕不是可校对的 Otoha 双语 ASS，或包含不支持的格式。原文件未修改。"
        case .invalidEdits: "每句字幕都需要原文和译文，且不能增删时间片段。"
        case .outsideLibrary: "只能校对当前视频字幕库中的 ASS 文件。"
        case .conflict: "字幕文件已在外部修改。请保留草稿，重新打开最新字幕后再保存。"
        case .tooLarge: "字幕文件或编辑内容过大，无法在侧栏中校对。"
        }
    }
}
