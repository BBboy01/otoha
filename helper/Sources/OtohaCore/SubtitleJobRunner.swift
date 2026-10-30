import Foundation

public struct SubtitleJobRunnerDependencies: Sendable {
    public let prepareTranslation: @Sendable () async throws -> Void
    public let transcribe: @Sendable () async throws -> TranscriptionOutput
    public let translate: @Sendable ([TranscribedCue]) async throws -> [String]

    public init(
        prepareTranslation: @escaping @Sendable () async throws -> Void,
        transcribe: @escaping @Sendable () async throws -> TranscriptionOutput,
        translate: @escaping @Sendable ([TranscribedCue]) async throws -> [String]
    ) {
        self.prepareTranslation = prepareTranslation
        self.transcribe = transcribe
        self.translate = translate
    }
}

public struct SubtitleJobRunner: Sendable {
    private let dependencies: SubtitleJobRunnerDependencies

    public init(dependencies: SubtitleJobRunnerDependencies) {
        self.dependencies = dependencies
    }

    public func run(
        configuration: JobConfiguration,
        cancellation: JobCancellationToken,
        emit: @escaping @Sendable (HelperEvent) -> Void = { _ in }
    ) async throws -> URL {
        emit(.phase(.checkingEnvironment, message: "正在检查环境"))
        try configuration.validate()
        try FileManager.default.createDirectory(at: configuration.outputDirectory, withIntermediateDirectories: true)
        try cancellation.check()

        emit(.phase(.preparingLanguageResources, message: "正在准备翻译语言资源"))
        try await dependencies.prepareTranslation()
        try cancellation.check()

        let transcription = try await dependencies.transcribe()
        try cancellation.check()

        let translations = try await dependencies.translate(transcription.cues)
        try cancellation.check()
        guard translations.count == transcription.cues.count else {
            throw SubtitleJobPipelineError.incompleteTranslation
        }

        let cues = transcription.cues.enumerated().map { index, cue in
            let start = max(0, cue.start + transcription.sourceTimeOffset)
            let end = max(start + 0.05, cue.end + transcription.sourceTimeOffset)
            return SubtitleCue(start: start, end: end, source: cue.source, translation: translations[index])
        }
        emit(.phase(.saving, message: "正在保存双语 ASS 字幕"))
        return try ASSOutput.publish(
            cues,
            baseName: SubtitleFilename.generatedBaseName(
                for: configuration.mediaURL,
                sourceLanguage: configuration.sourceLanguage,
                targetLanguage: configuration.targetLanguage
            ),
            directory: configuration.outputDirectory,
            overwriteExisting: true,
            subtitleScale: configuration.subtitleScale,
            isCancelled: { cancellation.isCancelled }
        )
    }
}
