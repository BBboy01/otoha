import Foundation
import OtohaCore

struct HelperRequest: Decodable {
    let backend: TranscriptionBackend
    let mediaPath: String
    let ffmpegPath: String
    let audioStreamIndex: Int
    let sourceLanguage: String
    let targetLanguage: String
    let subtitleScale: Double?
    let outputDirectoryPath: String?
    let cancellationFilePath: String

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
