import Foundation
import OtohaCore

struct HelperRequest: Decodable {
    private enum CodingKeys: String, CodingKey {
        case protocolVersion
        case jobId
        case backend
        case mediaPath
        case ffmpegPath
        case audioStreamIndex
        case sourceLanguage
        case targetLanguage
        case subtitleScale
        case outputDirectoryPath
        case cancellationFilePath
    }

    let protocolVersion: Int
    let jobId: String
    let backend: TranscriptionBackend
    let mediaPath: String
    let ffmpegPath: String
    let audioStreamIndex: Int
    let sourceLanguage: String
    let targetLanguage: String
    let subtitleScale: Double?
    let outputDirectoryPath: String?
    let cancellationFilePath: String

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let protocolVersion = try values.decode(Int.self, forKey: .protocolVersion)
        guard protocolVersion == HelperProtocol.version else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: values,
                debugDescription: "Unsupported helper protocol version."
            )
        }
        let jobId = try values.decode(String.self, forKey: .jobId)
        guard !jobId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .jobId,
                in: values,
                debugDescription: "The helper job ID must not be empty."
            )
        }
        self.protocolVersion = protocolVersion
        self.jobId = jobId
        let mediaPath = try values.decode(String.self, forKey: .mediaPath)
        let ffmpegPath = try values.decode(String.self, forKey: .ffmpegPath)
        let outputDirectoryPath = try values.decodeIfPresent(String.self, forKey: .outputDirectoryPath)
        let cancellationFilePath = try values.decode(String.self, forKey: .cancellationFilePath)
        let outputPathIsValid = outputDirectoryPath.map { $0.isEmpty || Self.isAbsolutePath($0) } ?? true
        guard Self.isAbsolutePath(mediaPath), Self.isAbsolutePath(ffmpegPath), Self.isAbsolutePath(cancellationFilePath),
              outputPathIsValid else {
            throw DecodingError.dataCorruptedError(
                forKey: .mediaPath,
                in: values,
                debugDescription: "Media, FFmpeg, cancellation, and output paths must be absolute."
            )
        }
        backend = try values.decode(TranscriptionBackend.self, forKey: .backend)
        self.mediaPath = mediaPath
        self.ffmpegPath = ffmpegPath
        audioStreamIndex = try values.decode(Int.self, forKey: .audioStreamIndex)
        sourceLanguage = try values.decode(String.self, forKey: .sourceLanguage)
        targetLanguage = try values.decode(String.self, forKey: .targetLanguage)
        subtitleScale = try values.decodeIfPresent(Double.self, forKey: .subtitleScale)
        self.outputDirectoryPath = outputDirectoryPath
        self.cancellationFilePath = cancellationFilePath
    }

    private static func isAbsolutePath(_ value: String) -> Bool {
        value.hasPrefix("/") && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var configuration: JobConfiguration {
        let mediaURL = URL(fileURLWithPath: mediaPath)
        let rootDirectory = SubtitleLibrary.rootDirectory(configuredPath: outputDirectoryPath)
        return JobConfiguration(
            backend: backend,
            mediaURL: mediaURL,
            ffmpegPath: ffmpegPath,
            audioStreamIndex: audioStreamIndex,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            subtitleScale: subtitleScale ?? 1.0,
            outputDirectory: SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: rootDirectory)
        )
    }

    var cancellationFileURL: URL {
        URL(fileURLWithPath: cancellationFilePath)
    }

}

struct SubtitleListingRequest: Decodable {
    let mediaPath: String
    let outputDirectoryPath: String?

    var mediaURL: URL { URL(fileURLWithPath: mediaPath) }
    var rootDirectory: URL { SubtitleLibrary.rootDirectory(configuredPath: outputDirectoryPath) }
}

struct SubtitleListingResponse: Encodable {
    struct Entry: Encodable {
        let path: String
    }

    let rootDirectoryPath: String
    let files: [Entry]
}
