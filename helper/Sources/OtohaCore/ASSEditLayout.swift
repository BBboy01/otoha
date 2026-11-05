import Foundation

struct ASSEditLayout {
    private struct Style {
        let font: String
        let size: Int
        let left: Double
        let right: Double
        let scale: Double
    }
    private let width: Double
    private let styles: [String: Style]
    private var breakers: [String: SubtitleLineBreaker] = [:]

    init(lines: [String]) throws {
        var section = "", format: [String] = [], styles: [String: Style] = [:]
        var width: Double?
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("[") { section = trimmed.lowercased(); continue }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let body = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            if section == "[script info]", key == "playresx" { width = Double(body) }
            guard section == "[v4+ styles]" else { continue }
            if key == "format" { format = body.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }; continue }
            guard key == "style", Set(format).count == format.count else { continue }
            let values = body.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            guard values.count == format.count else { throw ASSEditError.invalidDocument }
            let fields = Dictionary(uniqueKeysWithValues: zip(format, values))
            guard let name = fields["name"], ["OtohaSource", "OtohaTranslation"].contains(name) else { continue }
            guard let font = fields["fontname"], let size = Double(fields["fontsize"] ?? ""), size.isFinite, (1...512).contains(size),
                  let left = Double(fields["marginl"] ?? ""), left.isFinite, left >= 0,
                  let right = Double(fields["marginr"] ?? ""), right.isFinite, right >= 0,
                  let scale = Double(fields["scalex"] ?? "100"), scale.isFinite, (1...1000).contains(scale) else { throw ASSEditError.invalidDocument }
            styles[name] = Style(font: font, size: Int(size.rounded()), left: left, right: right, scale: scale / 100)
        }
        guard let width, width.isFinite, (1...1_000_000).contains(width), styles.count == 2 else { throw ASSEditError.invalidDocument }
        self.width = width; self.styles = styles
    }

    mutating func wrapped(_ value: String, style name: String, left: Double?, right: Double?) -> String {
        guard let style = styles[name] else { return value }
        let left = left.flatMap { $0 > 0 ? $0 : nil } ?? style.left
        let right = right.flatMap { $0 > 0 ? $0 : nil } ?? style.right
        let key = "\(name):\(left):\(right)"
        var breaker = breakers[key] ?? SubtitleLineBreaker(fontSize: style.size, width: (width - left - right - 10) / style.scale, fontName: style.font)
        let wrapped = value.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n").flatMap { breaker.lines($0) }.joined(separator: "\n")
        breakers[key] = breaker
        return wrapped
    }
}
