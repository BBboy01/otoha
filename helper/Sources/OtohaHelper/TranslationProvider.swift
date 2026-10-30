import Foundation
import OtohaCore
import Translation

@MainActor
struct TranslationProvider {
    func prepare(using session: TranslationSessionHandle) async throws {
        do {
            try await session.value.prepareTranslation()
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw TranslationProviderError.failed(error.localizedDescription)
        }
    }

    func translate(
        _ cues: [TranscribedCue],
        using session: TranslationSessionHandle,
        cancellationFileURL: URL,
        emit: @escaping @Sendable (HelperEvent) -> Void
    ) async throws -> [String] {
        var translated = try TranslationAccumulator(count: cues.count)
        let batchSize = 64

        do {
            for start in stride(from: 0, to: cues.count, by: batchSize) {
                try checkCancellation(cancellationFileURL)
                let end = min(start + batchSize, cues.count)
                let requests = (start..<end).map { index in
                    TranslationSession.Request(sourceText: cues[index].source, clientIdentifier: String(index))
                }
                for try await response in session.value.translate(batch: requests) {
                    try translated.record(
                        clientIdentifier: response.clientIdentifier,
                        targetText: response.targetText,
                        batchRange: start..<end
                    )
                    emit(.phase(.translating, message: "正在翻译字幕", progress: translated.progress))
                }
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw TranslationProviderError.failed(error.localizedDescription)
        }

        return try translated.finish()
    }

    private func checkCancellation(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) { throw CancellationError() }
    }
}

enum TranslationProviderError: Error, LocalizedError {
    case failed(String)

    var errorDescription: String? {
        switch self {
        case let .failed(reason): "Apple 翻译失败：\(reason)"
        }
    }
}

final class TranslationSessionHandle: @unchecked Sendable {
    let value: TranslationSession

    init(_ value: TranslationSession) {
        self.value = value
    }
}
