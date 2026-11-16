import Foundation

public enum SRTImporter {
    public static let maximumBytes = 16 * 1024 * 1024

    public static func parse(_ data: Data) throws -> [TranscribedCue] {
        guard data.count <= maximumBytes, let decoded = String(data: data, encoding: .utf8),
              !decoded.unicodeScalars.contains(where: { $0.value == 0 }) else { throw ImportError.invalidEncoding }
        let normalized = decoded.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let lines = normalized.trimmingCharacters(in: CharacterSet(charactersIn: "\u{FEFF}")).components(separatedBy: "\n")
        var index = 0
        var cues: [TranscribedCue] = []
        while index < lines.count {
            while index < lines.count && lines[index].trimmingCharacters(in: .whitespaces).isEmpty { index += 1 }
            if index == lines.count { break }
            guard let sequence = Int(lines[index].trimmingCharacters(in: .whitespaces)), sequence > 0 else { throw ImportError.invalidCue(index + 1) }
            index += 1
            guard index < lines.count else { throw ImportError.invalidCue(index + 1) }
            let range = lines[index].components(separatedBy: " --> ")
            guard range.count == 2, let start = time(range[0]), let end = time(range[1]), end > start else {
                throw ImportError.invalidCue(index + 1)
            }
            index += 1
            var texts: [String] = []
            while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).isEmpty {
                texts.append(lines[index]); index += 1
            }
            let text = texts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { throw ImportError.invalidCue(index + 1) }
            cues.append(TranscribedCue(start: start, end: end, source: text))
        }
        guard !cues.isEmpty else { throw ImportError.empty }
        return cues
    }

    private static func time(_ value: String) -> Double? {
        let parts = value.trimmingCharacters(in: .whitespaces).components(separatedBy: CharacterSet(charactersIn: ":,"))
        guard parts.count == 4, parts[0].count >= 2, parts[0].count <= 6,
              parts[1].count == 2, parts[2].count == 2, parts[3].count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              let h = Int(parts[0]), let m = Int(parts[1]), let s = Int(parts[2]), let ms = Int(parts[3]),
              m < 60, s < 60 else { return nil }
        return Double(h * 3600 + m * 60 + s) + Double(ms) / 1000
    }
}

public enum ImportError: Error, LocalizedError {
    case invalidEncoding, invalidCue(Int), empty, outsideLibrary
    public var errorDescription: String? {
        switch self {
        case .invalidEncoding: "字幕必须为不超过 16 MB 的 UTF-8 文件。"
        case let .invalidCue(line): "SRT 第 \(line) 行附近的序号、时间或正文无效。"
        case .empty: "字幕文件中没有有效片段。"
        case .outsideLibrary: "只能重翻译当前视频字幕库内的 ASS。"
        }
    }
}
