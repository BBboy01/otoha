import Foundation
import OtohaCore

struct FFmpegProcessRunner {
    func extract(
        configuration: JobConfiguration,
        outputURL: URL,
        cancellationFileURL: URL,
        audioFormat: AudioFormatSpecification,
        emit: @escaping @Sendable (HelperEvent) -> Void
    ) async throws -> Double {
        try await FFmpegExtractor.extract(
            configuration: configuration,
            outputURL: outputURL,
            cancellationFileURL: cancellationFileURL,
            audioFormat: audioFormat,
            emit: emit
        )
    }
}
