import Foundation
import OtohaCore

struct SpeechTranscriberClient {
    func prepare(
        sourceLanguage: String,
        cancellationFileURL: URL,
        emit: @escaping @Sendable (HelperEvent) -> Void
    ) async throws -> PreparedSpeechTranscriber {
        try await SpeechTranscriptionService.prepare(
            sourceLanguage: sourceLanguage,
            cancellationFileURL: cancellationFileURL,
            emit: emit
        )
    }

    func transcribe(
        audioURL: URL,
        using prepared: PreparedSpeechTranscriber,
        cancellationFileURL: URL,
        emit: @escaping @Sendable (HelperEvent) -> Void
    ) async throws -> [TranscribedCue] {
        try await SpeechTranscriptionService.transcribe(
            audioURL: audioURL,
            using: prepared,
            cancellationFileURL: cancellationFileURL,
            emit: emit
        )
    }
}
