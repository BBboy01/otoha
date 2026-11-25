import Foundation

public struct SubtitleJobRunnerDependencies: Sendable {
    public let preflight: @Sendable () async throws -> Void
    public let prepareTranslation: @Sendable () async throws -> Void
    public let transcribe: @Sendable () async throws -> TranscriptionOutput
    public let translate: @Sendable ([TranscribedCue]) async throws -> [String]

    public init(
        preflight: @escaping @Sendable () async throws -> Void = {},
        prepareTranslation: @escaping @Sendable () async throws -> Void,
        transcribe: @escaping @Sendable () async throws -> TranscriptionOutput,
        translate: @escaping @Sendable ([TranscribedCue]) async throws -> [String]
    ) {
        self.preflight = preflight
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
        try cancellation.check()
        let imported = configuration.generationMode == .translate ? try TranslationInputStore.read(configuration: configuration) : nil

        emit(.phase(.checkingEnvironment, message: "正在检查语言支持与资源"))
        try await dependencies.preflight()
        try cancellation.check()

        if configuration.generationMode.requiresTranslation {
            emit(.phase(.preparingLanguageResources, message: "正在准备翻译语言资源"))
            try await dependencies.prepareTranslation()
            try cancellation.check()
        }

        let transcription: TranscriptionOutput
        if configuration.generationMode == .translate {
            guard let imported else { throw ImportError.empty }
            transcription = imported
        } else {
            let cache = TranscriptionCache(directory: configuration.outputDirectory.deletingLastPathComponent()
                .appendingPathComponent(".TranscriptionCache", isDirectory: true))
            let originalMedia = try configuration.mediaURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .fileResourceIdentifierKey])
            let key = try cache.key(mediaURL: configuration.mediaURL, audioStreamIndex: configuration.audioStreamIndex,
                                    sourceLanguage: configuration.sourceLanguage, checkCancellation: { try cancellation.check() })
            if !configuration.forceTranscription, let cached = cache.load(key: key) {
                emit(.phase(.transcribing, message: "正在复用已完成的转录"))
                transcription = cached
            } else {
                transcription = try await dependencies.transcribe()
                try cancellation.check()
                let currentMedia = try configuration.mediaURL.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .fileResourceIdentifierKey])
                guard currentMedia.fileSize == originalMedia.fileSize,
                      currentMedia.contentModificationDate == originalMedia.contentModificationDate,
                      String(describing: currentMedia.fileResourceIdentifier) == String(describing: originalMedia.fileResourceIdentifier) else {
                    throw JobConfigurationError.mediaNotReadable
                }
                do {
                    try cache.save(transcription, key: key)
                } catch let error as NSError where error.domain == NSCocoaErrorDomain || error.domain == NSPOSIXErrorDomain {
                    try cancellation.check()
                    emit(.phase(.transcribing, message: "转录已完成，缓存不可用；继续生成字幕"))
                }
            }
        }
        try cancellation.check()

        let translations = configuration.generationMode == .source ? [] : try await dependencies.translate(transcription.cues)
        try cancellation.check()
        guard configuration.generationMode == .source || translations.count == transcription.cues.count else {
            throw SubtitleJobPipelineError.incompleteTranslation
        }

        let cues = transcription.cues.enumerated().map { index, cue in
            let start = max(0, cue.start + transcription.sourceTimeOffset)
            let end = configuration.generationMode == .translate ? cue.end : max(start + 0.05, cue.end + transcription.sourceTimeOffset)
            return SubtitleCue(start: start, end: end, source: cue.source, translation: configuration.generationMode == .source ? "" : translations[index])
        }
        emit(.phase(.saving, message: "正在保存 ASS 字幕"))
        try FileManager.default.createDirectory(at: configuration.outputDirectory, withIntermediateDirectories: true)
        return try ASSOutput.publish(
            cues,
            baseName: configuration.generationMode == .source ? "\(SubtitleFilename.mediaBaseName(for: configuration.mediaURL)) [\(configuration.sourceLanguage)]" : SubtitleFilename.generatedBaseName(
                for: configuration.mediaURL,
                sourceLanguage: configuration.sourceLanguage,
                targetLanguage: configuration.targetLanguage
            ),
            directory: configuration.outputDirectory,
            overwriteExisting: false,
            subtitleScale: configuration.subtitleScale,
            subtitleFont: configuration.subtitleFont,
            subtitleStyle: configuration.subtitleStyle,
            videoWidth: configuration.videoWidth,
            videoHeight: configuration.videoHeight,
            sourceOnly: configuration.generationMode == .source,
            isCancelled: { cancellation.isCancelled }
        )
    }
}
