import Foundation

public enum TranscriptionBackend: String, Codable, Sendable {
    case apple
}

public struct JobConfiguration: Codable, Sendable {
    public let backend: TranscriptionBackend
    public let mediaURL: URL
    public let ffmpegPath: String
    public let audioStreamIndex: Int
    public let sourceLanguage: String
    public let targetLanguage: String
    public let outputDirectory: URL

    public init(
        backend: TranscriptionBackend = .apple,
        mediaURL: URL,
        ffmpegPath: String,
        audioStreamIndex: Int,
        sourceLanguage: String,
        targetLanguage: String,
        outputDirectory: URL
    ) {
        self.backend = backend
        self.mediaURL = mediaURL
        self.ffmpegPath = ffmpegPath
        self.audioStreamIndex = audioStreamIndex
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.outputDirectory = outputDirectory
    }

    public func validate(fileManager: FileManager = .default, environment: [String: String] = ProcessInfo.processInfo.environment) throws {
        guard mediaURL.isFileURL, fileManager.isReadableFile(atPath: mediaURL.path) else {
            throw JobConfigurationError.mediaNotReadable
        }
        guard FFmpegLocator.resolve(configuredPath: ffmpegPath, environment: environment, fileManager: fileManager) != nil else {
            throw JobConfigurationError.ffmpegNotExecutable
        }
        guard audioStreamIndex >= 0 else {
            throw JobConfigurationError.invalidAudioStream
        }
        guard Self.isLanguageIdentifier(sourceLanguage),
              Self.isLanguageIdentifier(targetLanguage),
              sourceLanguage != targetLanguage else {
            throw JobConfigurationError.invalidLanguages
        }
        var isDirectory = ObjCBool(false)
        guard outputDirectory.isFileURL,
              fileManager.fileExists(atPath: outputDirectory.path, isDirectory: &isDirectory),
              isDirectory.boolValue,
              fileManager.isWritableFile(atPath: outputDirectory.path) else {
            throw JobConfigurationError.outputDirectoryNotWritable
        }
    }

    private static func isLanguageIdentifier(_ value: String) -> Bool {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard !parts.isEmpty else { return false }
        return parts.allSatisfy { part in
            !part.isEmpty && part.count <= 8 && part.allSatisfy(\.isASCII) && part.allSatisfy(\.isLetterOrNumber)
        }
    }
}

public enum FFmpegLocator {
    public static func resolve(
        configuredPath: String,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let candidates: [String]
        if configuredPath.isEmpty {
            candidates = (environment["PATH"] ?? "").split(separator: ":").map {
                URL(fileURLWithPath: String($0), isDirectory: true).appendingPathComponent("ffmpeg").path
            }
        } else {
            candidates = [configuredPath]
        }
        return candidates.first(where: { fileManager.isExecutableFile(atPath: $0) })
            .map { URL(fileURLWithPath: $0).standardizedFileURL }
    }

    public static func resolveProbe(
        beside ffmpegURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default
    ) -> URL? {
        let sibling = ffmpegURL.deletingLastPathComponent().appendingPathComponent("ffprobe")
        if fileManager.isExecutableFile(atPath: sibling.path) { return sibling }
        let path = (environment["PATH"] ?? "").split(separator: ":").map {
            URL(fileURLWithPath: String($0), isDirectory: true).appendingPathComponent("ffprobe").path
        }
        return path.first(where: { fileManager.isExecutableFile(atPath: $0) })
            .map { URL(fileURLWithPath: $0).standardizedFileURL }
    }
}

public enum JobConfigurationError: Error, Equatable, LocalizedError {
    case mediaNotReadable
    case ffmpegNotExecutable
    case invalidAudioStream
    case invalidLanguages
    case outputDirectoryNotWritable

    public var errorDescription: String? {
        switch self {
        case .mediaNotReadable: "无法读取所选视频。"
        case .ffmpegNotExecutable: "找不到可执行的 FFmpeg。"
        case .invalidAudioStream: "所选音频流索引无效。"
        case .invalidLanguages: "请选择两个不同的有效语言。"
        case .outputDirectoryNotWritable: "字幕输出文件夹不存在或不可写。"
        }
    }
}

private extension Character {
    var isLetterOrNumber: Bool {
        isASCII && (isLetter || isNumber)
    }
}
