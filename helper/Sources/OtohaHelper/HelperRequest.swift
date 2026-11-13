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
        case subtitleFont
        case subtitleStyle
        case videoWidth
        case videoHeight
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
    let subtitleFont: String?
    let subtitleStyle: SubtitleStyle?
    let videoWidth: Int?
    let videoHeight: Int?
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
        subtitleFont = try values.decodeIfPresent(String.self, forKey: .subtitleFont)
        subtitleStyle = try values.decodeIfPresent(SubtitleStyle.self, forKey: .subtitleStyle)
        videoWidth = try values.decodeIfPresent(Int.self, forKey: .videoWidth)
        videoHeight = try values.decodeIfPresent(Int.self, forKey: .videoHeight)
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
            subtitleFont: subtitleFont ?? "Arial",
            subtitleStyle: subtitleStyle,
            videoWidth: videoWidth,
            videoHeight: videoHeight,
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

struct SubtitleExportRequest: Decodable {
    let protocolVersion: Int
    let mediaPath: String
    let subtitlePath: String
    let libraryRootPath: String
    let destinationDirectoryPath: String
    let mode: SRTExportMode

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let protocolVersion = try values.decode(Int.self, forKey: .protocolVersion)
        let mediaPath = try values.decode(String.self, forKey: .mediaPath)
        let subtitlePath = try values.decode(String.self, forKey: .subtitlePath)
        let libraryRootPath = try values.decode(String.self, forKey: .libraryRootPath)
        let destinationDirectoryPath = try values.decode(String.self, forKey: .destinationDirectoryPath)
        guard protocolVersion == HelperProtocol.version,
              Self.isAbsolute(mediaPath), Self.isAbsolute(subtitlePath),
              Self.isAbsolute(libraryRootPath), Self.isAbsolute(destinationDirectoryPath) else {
            throw DecodingError.dataCorruptedError(
                forKey: .protocolVersion,
                in: values,
                debugDescription: "Export protocol version and paths are invalid."
            )
        }
        self.protocolVersion = protocolVersion
        self.mediaPath = mediaPath
        self.subtitlePath = subtitlePath
        self.libraryRootPath = libraryRootPath
        self.destinationDirectoryPath = destinationDirectoryPath
        mode = try values.decode(SRTExportMode.self, forKey: .mode)
    }

    private enum CodingKeys: String, CodingKey {
        case protocolVersion, mediaPath, subtitlePath, libraryRootPath, destinationDirectoryPath, mode
    }

    private static func isAbsolute(_ value: String) -> Bool {
        value.hasPrefix("/") && !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var outputURL: URL {
        get throws {
            try SRTExportStore.write(
                subtitleURL: URL(fileURLWithPath: subtitlePath),
                mediaURL: URL(fileURLWithPath: mediaPath),
                libraryRoot: URL(fileURLWithPath: libraryRootPath, isDirectory: true),
                destinationDirectory: URL(fileURLWithPath: destinationDirectoryPath, isDirectory: true),
                mode: mode
            )
        }
    }
}

struct SubtitleExportResponse: Encodable {
    let path: String
}
