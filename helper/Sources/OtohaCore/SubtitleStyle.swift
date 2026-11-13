import Foundation

public struct SubtitleStyle: Codable, Sendable {
    public let font: String
    public let scale: Double
    public let color: String
    public let background: Bool
    public let dimSource: Bool

    public init(font: String = "Arial", scale: Double = 1, color: String = "#FFFFFF",
                background: Bool = false, dimSource: Bool = true) {
        self.font = font; self.scale = scale; self.color = color
        self.background = background; self.dimSource = dimSource
    }

    public func validate() throws {
        try ASSWriter.validateFontName(font)
        guard scale.isFinite, (0.5...3).contains(scale) else { throw ASSError.invalidScale }
        guard color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil else {
            throw ASSError.invalidColor
        }
    }

    public func applying(to content: String) throws -> String {
        try validate()
        let newline = content.contains("\r\n") ? "\r\n" : "\n"
        var lines = content.components(separatedBy: newline)
        var inStyles = false, format: [String] = []
        let rgb = Array(color.dropFirst().uppercased())
        let bgr = String(rgb[4...5] + rgb[2...3] + rgb[0...1])
        var found = Set<String>()
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") { inStyles = trimmed.lowercased() == "[v4+ styles]"; continue }
            guard inStyles, let colon = line.firstIndex(of: ":") else { continue }
            let kind = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let body = String(line[line.index(after: colon)...])
            if kind == "format" {
                format = body.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                continue
            }
            guard kind == "style" else { continue }
            var fields = body.components(separatedBy: ",")
            guard fields.count == format.count, Set(format).count == format.count,
                  let nameIndex = format.firstIndex(of: "name") else { throw ASSEditError.invalidDocument }
            let name = fields[nameIndex].trimmingCharacters(in: .whitespaces)
            guard ["OtohaSource", "OtohaTranslation"].contains(name) else { continue }
            let source = name == "OtohaSource"
            let updates = [
                "fontname": font, "fontsize": String(Int(((source ? 38.0 : 34.0) * scale).rounded())),
                "primarycolour": "&H\(source && dimSource ? "50" : "00")\(bgr)",
                "outlinecolour": background ? "&H80000000" : "&H00000000",
                "backcolour": "&H80000000", "borderstyle": background ? "3" : "1",
                "outline": "3.5", "shadow": background ? "0" : "1.5",
            ]
            for (key, value) in updates {
                guard let field = format.firstIndex(of: key) else { throw ASSEditError.invalidDocument }
                fields[field] = value
            }
            lines[index] = String(line[...colon]) + fields.joined(separator: ",")
            found.insert(name)
        }
        guard found.count == 2 else { throw ASSEditError.invalidDocument }
        let document = try ASSEditDocument(lines.joined(separator: newline))
        return try document.replacingTexts(document.cues.map { ASSEditText(source: $0.source, translation: $0.translation) }, forceRewrap: true)
    }
}
