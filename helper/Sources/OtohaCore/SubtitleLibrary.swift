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
        let baseName = SubtitleFilename.mediaBaseName(for: mediaURL)
        return rootDirectory.appendingPathComponent("\(baseName)-\(digest.prefix(16))", isDirectory: true)
    }

    public static func list(
        for mediaURL: URL,
        rootDirectory: URL,
        fileManager: FileManager = .default
    ) throws -> [URL] {
        let directory = mediaDirectory(for: mediaURL, rootDirectory: rootDirectory)
        guard fileManager.fileExists(atPath: directory.path) else { return [] }
        let candidates = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
        )
        let files = candidates
            .filter { isSubtitle($0, for: mediaURL) }
            .map(\.standardizedFileURL)

        return files.sorted { lhs, rhs in
            let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if lhsDate != rhsDate { return lhsDate > rhsDate }
            return lhs.lastPathComponent.localizedStandardCompare(rhs.lastPathComponent) == .orderedAscending
        }
    }

    private static func isSubtitle(_ url: URL, for mediaURL: URL) -> Bool {
        SubtitleFilename.isSubtitle(url, for: mediaURL)
            && (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }
}
