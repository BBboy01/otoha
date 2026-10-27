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
        emit(.phase(.checkingEnvironment, message: "正在检查环境"))
        try configuration.validate()
        try checkCancellation(cancellationFileURL)

        emit(.phase(.preparingLanguageResources, message: "正在准备翻译语言资源"))
        try await prepareTranslation()
        try checkCancellation(cancellationFileURL)

        let transcription = try await transcribe()
        try checkCancellation(cancellationFileURL)

        let translations = try await translate(transcription.cues)
        try checkCancellation(cancellationFileURL)
        guard translations.count == transcription.cues.count else {
            throw SubtitleJobPipelineError.incompleteTranslation
        }

        let cues = transcription.cues.enumerated().map { index, cue in
            let start = max(0, cue.start + transcription.sourceTimeOffset)
            let end = max(start + 0.05, cue.end + transcription.sourceTimeOffset)
            return SubtitleCue(start: start, end: end, source: cue.source, translation: translations[index])
        }
        emit(.phase(.saving, message: "正在保存双语字幕"))
        return try SRTOutput.publish(
            cues,
            baseName: configuration.mediaURL.deletingPathExtension().lastPathComponent,
            directory: configuration.outputDirectory,
            cancellationFileURL: cancellationFileURL
        )
    }

    private static func checkCancellation(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) { throw CancellationError() }
    }
}

public enum SubtitleJobPipelineError: Error, Equatable, LocalizedError {
    case incompleteTranslation

    public var errorDescription: String? {
        "翻译没有为每个识别出的字幕片段生成结果。"
    }
}
