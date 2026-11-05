import CryptoKit
import Foundation

public struct ASSEditSnapshot: Encodable {
    public let path: String
    public let revision: String
    public let cues: [ASSEditCue]
}

public enum ASSEditStore {
    public static let maximumBytes = 16 * 1024 * 1024

    public static func read(mediaURL: URL, rootDirectory: URL, subtitleURL: URL) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let data = try readData(path)
        guard let content = String(data: data, encoding: .utf8) else { throw ASSEditError.invalidDocument }
        return ASSEditSnapshot(path: path.path, revision: revision(data), cues: try ASSEditDocument(content).cues)
    }

    public static func save(mediaURL: URL, rootDirectory: URL, subtitleURL: URL,
                            revision expectedRevision: String, texts: [ASSEditText]) throws -> ASSEditSnapshot {
        let path = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
        let original = try readData(path)
        guard revision(original) == expectedRevision else { throw ASSEditError.conflict }
        guard let content = String(data: original, encoding: .utf8) else { throw ASSEditError.invalidDocument }
        let edited = Data(try ASSEditDocument(content).replacingTexts(texts).utf8)
        guard edited.count <= maximumBytes else { throw ASSEditError.tooLarge }
        try ASSOutput.replace(edited, at: path) {
            _ = try authorizedURL(mediaURL: mediaURL, rootDirectory: rootDirectory, subtitleURL: subtitleURL)
            guard revision(try readData(path)) == expectedRevision else { throw ASSEditError.conflict }
        }
        return ASSEditSnapshot(path: path.path, revision: revision(edited), cues: try ASSEditDocument(String(decoding: edited, as: UTF8.self)).cues)
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
