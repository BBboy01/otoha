import CryptoKit
import Foundation

public struct TranscriptionCache: Sendable {
    public let directory: URL
    private struct Cue: Codable {
        let start: Double
        let end: Double
        let source: String
    }
    private struct Entry: Codable {
        let version: Int
        let key: String
        let offset: Double
        let cues: [Cue]
    }

    public init(directory: URL) {
        self.directory = directory.deletingLastPathComponent().resolvingSymlinksInPath()
            .appendingPathComponent(directory.lastPathComponent, isDirectory: true)
    }

    public func key(mediaURL: URL, audioStreamIndex: Int, sourceLanguage: String,
                    checkCancellation: () throws -> Void = {}) throws -> String {
        let handle = try FileHandle(forReadingFrom: mediaURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            try checkCancellation()
            guard let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty else { break }
            hasher.update(data: data)
        }
        hasher.update(data: Data("\n1\n\(mediaURL.standardizedFileURL.path)\n\(audioStreamIndex)\n\(sourceLanguage.lowercased())".utf8))
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    public func load(key: String) -> TranscriptionOutput? {
        let url = directory.appendingPathComponent("\(key).json")
        guard url.resolvingSymlinksInPath() == url.standardizedFileURL,
              let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= SRTImporter.maximumBytes,
              let data = try? Data(contentsOf: url), let entry = try? JSONDecoder().decode(Entry.self, from: data),
              entry.version == 1, entry.key == key, entry.offset.isFinite, !entry.cues.isEmpty,
              entry.cues.allSatisfy({ $0.start.isFinite && $0.end.isFinite && $0.end > $0.start && !$0.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { return nil }
        return TranscriptionOutput(cues: entry.cues.map { .init(start: $0.start, end: $0.end, source: $0.source) }, sourceTimeOffset: entry.offset)
    }

    public func save(_ output: TranscriptionOutput, key: String) throws {
        guard key.count == 64, key.allSatisfy({ $0.isASCII && $0.isHexDigit }) else { throw ImportError.outsideLibrary }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard directory.resolvingSymlinksInPath() == directory.standardizedFileURL else { throw ImportError.outsideLibrary }
        let entry = Entry(version: 1, key: key, offset: output.sourceTimeOffset,
            cues: output.cues.map { Cue(start: $0.start, end: $0.end, source: $0.source) })
        let data = try JSONEncoder().encode(entry)
        guard data.count <= SRTImporter.maximumBytes else { throw ImportError.invalidEncoding }
        try data.write(to: directory.appendingPathComponent("\(key).json"), options: .atomic)
        try prune()
    }

    private func prune() throws {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey, .isSymbolicLinkKey]
        let entries = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))
            .filter { url in
                let name = url.deletingPathExtension().lastPathComponent
                return url.pathExtension == "json" && name.count == 64 && name.allSatisfy { $0.isASCII && $0.isHexDigit }
            }.compactMap { url -> (URL, Int, Date)? in
                guard let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true,
                      values.isSymbolicLink != true else { return nil }
                return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
            }.sorted { $0.2 > $1.2 }
        var retained = 0
        var bytes = 0
        for (url, size, _) in entries {
            if retained < 100 && bytes + size <= 256 * 1024 * 1024 {
                retained += 1
                bytes += size
            } else { try FileManager.default.removeItem(at: url) }
        }
    }
}
