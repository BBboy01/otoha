import CryptoKit
import Foundation

public enum SubtitleLibrary {
    public static func rootDirectory(
        configuredPath: String?,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        if let configuredPath, !configuredPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let expanded = configuredPath.hasPrefix("~/")
                ? homeDirectory.appendingPathComponent(String(configuredPath.dropFirst(2))).path
                : configuredPath
            return URL(fileURLWithPath: expanded, isDirectory: true).standardizedFileURL
        }

        return homeDirectory
            .appendingPathComponent("Library/Application Support/Otoha/Subtitles", isDirectory: true)
            .standardizedFileURL
    }

    public static func mediaDirectory(for mediaURL: URL, rootDirectory: URL) -> URL {
        let mediaPath = mediaURL.standardizedFileURL.path
        let digest = SHA256.hash(data: Data(mediaPath.utf8)).map { String(format: "%02x", $0) }.joined()
        let baseName = mediaURL.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
        return rootDirectory.appendingPathComponent("\(baseName)-\(digest.prefix(16))", isDirectory: true)
    }

    public static func list(
        for mediaURL: URL,
        rootDirectory: URL,
        legacyDirectories: [URL] = [],
        fileManager: FileManager = .default
    ) throws -> [URL] {
        let directory = mediaDirectory(for: mediaURL, rootDirectory: rootDirectory)
        var files = Set<URL>()
        for sourceDirectory in [directory] + legacyDirectories {
            guard fileManager.fileExists(atPath: sourceDirectory.path) else { continue }
            let candidates = try fileManager.contentsOfDirectory(
                at: sourceDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
            )
            for url in candidates where isSubtitle(url, for: mediaURL) {
                files.insert(url.standardizedFileURL)
            }
        }

        return files.sorted { lhs, rhs in
            let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if lhsDate != rhsDate { return lhsDate > rhsDate }
            return lhs.lastPathComponent.localizedStandardCompare(rhs.lastPathComponent) == .orderedAscending
        }
    }

    private static func isSubtitle(_ url: URL, for mediaURL: URL) -> Bool {
        guard url.pathExtension.lowercased() == "srt",
              (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else { return false }
        let baseName = mediaURL.deletingPathExtension().lastPathComponent
        let stem = url.deletingPathExtension().lastPathComponent
        if stem == baseName || stem == "\(baseName).otoha" { return true }
        let generatedPrefix = "\(baseName) ["
        if stem.hasPrefix(generatedPrefix), stem.hasSuffix("]") {
            let languagePair = stem.dropFirst(generatedPrefix.count).dropLast()
            if languagePair.contains(" to ") { return true }
        }
        let prefixes = ["\(baseName) (", "\(baseName).otoha ("]
        guard let prefix = prefixes.first(where: { stem.hasPrefix($0) }), stem.hasSuffix(")") else { return false }
        let number = stem.dropFirst(prefix.count).dropLast()
        return !number.isEmpty && number.allSatisfy(\.isNumber)
    }
}
