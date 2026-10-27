import Foundation
import OtohaCore

struct HelperRequest: Decodable {
    let backend: TranscriptionBackend
    let mediaPath: String
    let ffmpegPath: String
    let audioStreamIndex: Int
    let sourceLanguage: String
    let targetLanguage: String
    let outputDirectoryPath: String
    let cancellationFilePath: String

    var configuration: JobConfiguration {
        JobConfiguration(
            backend: backend,
            mediaURL: URL(fileURLWithPath: mediaPath),
            ffmpegPath: ffmpegPath,
            audioStreamIndex: audioStreamIndex,
            sourceLanguage: sourceLanguage,
            targetLanguage: targetLanguage,
            outputDirectory: URL(fileURLWithPath: Self.expandingTilde(outputDirectoryPath), isDirectory: true)
        )
    }

    var cancellationFileURL: URL {
        URL(fileURLWithPath: cancellationFilePath)
    }

    private static func expandingTilde(_ path: String) -> String {
        path.hasPrefix("~/") ? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(String(path.dropFirst(2))).path : path
    }
}
