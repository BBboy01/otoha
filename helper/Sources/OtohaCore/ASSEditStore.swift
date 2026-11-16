import CryptoKit
import Foundation

public struct ASSEditSnapshot: Encodable {
    public let path: String
    public let revision: String
    public let cues: [ASSEditCue]
    public let mode: String
    public let draft: SubtitleDraft?
    public let history: [SubtitleBackup]
}

public struct SubtitleDraft: Codable, Sendable {
    public let revision: String
    public let cues: [ASSEditCue]
    public let index: Int
    public let scrollTop: Double
    public init(revision: String, cues: [ASSEditCue], index: Int, scrollTop: Double) {
        self.revision = revision; self.cues = cues; self.index = index; self.scrollTop = scrollTop
    }
}

public struct SubtitleBackup: Encodable {
    public let id: String
    public let modified: Double
}

public enum ASSEditStore {
    public static let maximumBytes = 16 * 1024 * 1024

    public static func read(mediaURL: URL, rootDirectory: URL, subtitleURL: URL) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let data = try readData(path)
        guard let content = String(data: data, encoding: .utf8) else { throw ASSEditError.invalidDocument }
        let document = try ASSEditDocument(content)
        return ASSEditSnapshot(path: path.path, revision: revision(data), cues: document.cues, mode: document.mode,
            draft: try? loadDraft(path),
            history: try history(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: path))
    }

    public static func save(mediaURL: URL, rootDirectory: URL, subtitleURL: URL,
                            revision expectedRevision: String, texts: [ASSEditText]) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let original = try readData(path)
        guard revision(original) == expectedRevision else { throw ASSEditError.conflict }
        guard let content = String(data: original, encoding: .utf8) else { throw ASSEditError.invalidDocument }
        let edited = Data(try ASSEditDocument(content).replacingTexts(texts).utf8)
        return try commit(edited, original: original, path: path, mediaURL: mediaURL, rootDirectory: rootDirectory, expectedRevision: expectedRevision)
    }

    public static func save(mediaURL: URL, rootDirectory: URL, subtitleURL: URL,
                            revision expectedRevision: String, cues: [ASSEditCue]) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let original = try readData(path)
        guard revision(original) == expectedRevision else { throw ASSEditError.conflict }
        guard let content = String(data: original, encoding: .utf8) else { throw ASSEditError.invalidDocument }
        let edited = Data(try ASSEditDocument(content).replacingCues(cues).utf8)
        return try commit(edited, original: original, path: path, mediaURL: mediaURL, rootDirectory: rootDirectory, expectedRevision: expectedRevision)
    }

    private static func commit(_ edited: Data, original: Data, path: URL, mediaURL: URL,
                               rootDirectory: URL, expectedRevision: String) throws -> ASSEditSnapshot {
        guard edited.count <= maximumBytes else { throw ASSEditError.tooLarge }
        _ = try ASSEditDocument(String(decoding: edited, as: UTF8.self))
        let directory = try prepareStorage(path)
        let backup = directory.appendingPathComponent("\(Date().timeIntervalSince1970)-\(UUID().uuidString).ass")
        try ASSOutput.replace(original, at: backup)
        try ASSOutput.replace(edited, at: path) {
            _ = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: path)
            guard revision(try readData(path)) == expectedRevision else { throw ASSEditError.conflict }
        }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent("draft.json"))
        let backups = try history(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: path)
        for item in backups.dropFirst(20) { try? FileManager.default.removeItem(at: directory.appendingPathComponent(item.id)) }
        return try read(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: path)
    }

    public static func persistDraft(mediaURL: URL, rootDirectory: URL, subtitleURL: URL, draft: SubtitleDraft?) throws {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let directory = try prepareStorage(path)
        let destination = directory.appendingPathComponent("draft.json")
        guard let draft else { if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }; return }
        guard draft.revision.count == 64, !draft.cues.isEmpty, draft.index >= 0, draft.index < draft.cues.count,
              draft.scrollTop.isFinite, draft.scrollTop >= 0 else { throw ASSEditError.invalidEdits }
        let data = try JSONEncoder().encode(draft)
        guard data.count <= maximumBytes else { throw ASSEditError.tooLarge }
        try ASSOutput.replace(data, at: destination)
    }

    public static func history(mediaURL: URL, rootDirectory: URL, subtitleURL: URL) throws -> [SubtitleBackup] {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let directory = storage(path)
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { throw ASSEditError.outsideLibrary }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
            .filter { $0.pathExtension == "ass" && $0.resolvingSymlinksInPath().path == $0.standardizedFileURL.path }
            .map { SubtitleBackup(id: $0.lastPathComponent, modified: (try $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0) }
            .sorted { $0.modified > $1.modified }
    }

    public static func restore(mediaURL: URL, rootDirectory: URL, subtitleURL: URL, revision expectedRevision: String, backupID: String) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        guard try history(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: path).contains(where: { $0.id == backupID }) else { throw ASSEditError.outsideLibrary }
        let original = try readData(path)
        guard revision(original) == expectedRevision else { throw ASSEditError.conflict }
        return try commit(readData(storage(path).appendingPathComponent(backupID)), original: original, path: path,
            mediaURL: mediaURL, rootDirectory: rootDirectory, expectedRevision: expectedRevision)
    }

    private static func storage(_ path: URL) -> URL {
        path.deletingLastPathComponent().appendingPathComponent(".otoha-history-\(revision(Data(path.lastPathComponent.utf8)))", isDirectory: true)
    }

    private static func loadDraft(_ path: URL) throws -> SubtitleDraft {
        let url = storage(path).appendingPathComponent("draft.json")
        guard url.resolvingSymlinksInPath().path == url.standardizedFileURL.path else { throw ASSEditError.outsideLibrary }
        return try JSONDecoder().decode(SubtitleDraft.self, from: readData(url))
    }

    public static func discardState(subtitleURL: URL) throws {
        let directory = storage(subtitleURL.standardizedFileURL)
        guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { throw ASSEditError.outsideLibrary }
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    private static func prepareStorage(_ path: URL) throws -> URL {
        let directory = storage(path)
        guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { throw ASSEditError.outsideLibrary }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func authorizedURL(mediaURL: URL, rootDirectory: URL, subtitleURL: URL) throws -> URL {
        let directory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: rootDirectory).standardizedFileURL
        let path = subtitleURL.standardizedFileURL
        guard path.deletingLastPathComponent() == directory,
              path.resolvingSymlinksInPath() == path,
              try SubtitleLibrary.list(for: mediaURL, rootDirectory: rootDirectory).contains(path) else {
            throw ASSEditError.outsideLibrary
        }
        return path
    }

    private static func readData(_ url: URL) throws -> Data {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? maximumBytes + 1
        guard size <= maximumBytes else { throw ASSEditError.tooLarge }
        let data = try Data(contentsOf: url)
        guard data.count <= maximumBytes else { throw ASSEditError.tooLarge }
        return data
    }

    private static func revision(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
