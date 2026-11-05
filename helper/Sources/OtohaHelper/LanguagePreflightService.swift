import Foundation
import OtohaCore
import Translation

@MainActor
enum LanguagePreflightService {
    @available(macOS 26.4, *)
    static func check(_ request: LanguagePreflightRequest) async throws -> LanguagePreflightResult {
        try request.validate()
        try Task.checkCancellation()
        let speech = await SpeechTranscriptionService.languageAvailability(sourceLanguage: request.sourceLanguage)
        try Task.checkCancellation()
        let availability = LanguageAvailability(preferredStrategy: .highFidelity)
        let translation: LanguageResourceStatus
        switch await availability.status(
            from: Locale.Language(identifier: request.sourceLanguage),
            to: Locale.Language(identifier: request.targetLanguage)
        ) {
        case .installed: translation = .installed
        case .supported: translation = .supported
        case .unsupported: translation = .unsupported
        @unknown default: translation = .unsupported
        }
        try Task.checkCancellation()
        return LanguagePreflightResult(requestId: request.requestId,
            sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage,
            speech: speech, translation: translation)
    }
}
