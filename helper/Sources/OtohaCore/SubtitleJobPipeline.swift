import Foundation

public struct TranscribedCue: Sendable, Equatable {
    public let start: Double
    public let end: Double
    public let source: String

    public init(start: Double, end: Double, source: String) {
        self.start = start
        self.end = end
        self.source = source
    }
}

public struct TranscriptionOutput: Sendable {
    public let cues: [TranscribedCue]
    public let sourceTimeOffset: Double

    public init(cues: [TranscribedCue], sourceTimeOffset: Double) {
        self.cues = cues
        self.sourceTimeOffset = sourceTimeOffset
    }
}

public enum SubtitleJobPipeline {
    public static func run(
        configuration: JobConfiguration,
        cancellationFileURL: URL,
        prepareTranslation: @escaping @Sendable () async throws -> Void,
        transcribe: @escaping @Sendable () async throws -> TranscriptionOutput,
        translate: @escaping @Sendable ([TranscribedCue]) async throws -> [String],
        emit: @escaping @Sendable (HelperEvent) -> Void = { _ in }
    ) async throws -> URL {
        let runner = SubtitleJobRunner(dependencies: .init(
            prepareTranslation: prepareTranslation,
            transcribe: transcribe,
            translate: translate
        ))
        return try await runner.run(
            configuration: configuration,
            cancellation: JobCancellationToken(cancellationFileURL: cancellationFileURL),
            emit: emit
        )
    }
}

public enum SubtitleJobPipelineError: Error, Equatable, LocalizedError {
    case incompleteTranslation

    public var errorDescription: String? {
        "翻译没有为每个识别出的字幕片段生成结果。"
    }
}
