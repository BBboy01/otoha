import Foundation

public enum SubtitleFilename {
    public static func mediaBaseName(for mediaURL: URL) -> String {
        sanitizedBaseName(mediaURL.deletingPathExtension().lastPathComponent)
    }

    public static func generatedBaseName(
        for mediaURL: URL,
        sourceLanguage: String,
        targetLanguage: String
    ) -> String {
        "\(mediaBaseName(for: mediaURL)) [\(sourceLanguage) to \(targetLanguage)]"
    }

    public static func isSubtitle(_ url: URL, for mediaURL: URL) -> Bool {
        guard url.pathExtension.lowercased() == "ass" else { return false }
        let baseName = mediaBaseName(for: mediaURL)
        let stem = url.deletingPathExtension().lastPathComponent
        if stem == baseName || stem == "\(baseName).otoha" { return true }
        var generatedStem = stem
        if stem.hasSuffix(")"), let suffix = stem.range(of: " (", options: .backwards) {
            let digits = stem[suffix.upperBound...].dropLast()
            if digits.allSatisfy(\.isNumber), let version = Int(digits), version >= 2 {
                generatedStem = String(stem[..<suffix.lowerBound])
            }
        }
        let generatedPrefix = "\(baseName) ["
        if generatedStem.hasPrefix(generatedPrefix), generatedStem.hasSuffix("]") {
            let languagePair = generatedStem.dropFirst(generatedPrefix.count).dropLast()
            if languagePair.contains(" to ") { return true }
        }
        let prefixes = ["\(baseName) (", "\(baseName).otoha ("]
        guard let prefix = prefixes.first(where: { stem.hasPrefix($0) }), stem.hasSuffix(")") else {
            return false
        }
        let number = stem.dropFirst(prefix.count).dropLast()
        return !number.isEmpty && number.allSatisfy(\.isNumber)
    }

    public static func sanitizedBaseName(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "Subtitle" : cleaned
    }
}
