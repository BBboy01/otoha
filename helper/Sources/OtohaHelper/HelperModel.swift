import AppKit
import Combine
import Foundation
import OtohaCore
import Speech
import Translation

@MainActor
final class HelperModel: ObservableObject {
    @Published private(set) var message = "等待任务启动"
    @Published private(set) var progress: Double?
    @Published private(set) var finished = false
    @Published private(set) var cancelled = false
    @Published private(set) var outputURL: URL?

    let request: HelperRequest?
    let startupError: String?
    private var hasStarted = false
    private var startupErrorReported = false
    private var cancelSpeechOperation: (@MainActor () -> Void)?

    init(request: HelperRequest?, startupError: String?) {
        self.request = request
        self.startupError = startupError
    }

    var sourceLanguage: Locale.Language? {
        request.map { Locale.Language(identifier: $0.sourceLanguage) }
    }

    var targetLanguage: Locale.Language? {
        request.map { Locale.Language(identifier: $0.targetLanguage) }
    }

    func reportStartupError() {
        guard let startupError, !startupErrorReported else { return }
        startupErrorReported = true
        message = startupError
        emit(.failure(code: .invalidRequest, message: startupError))
        terminateAfterShowingResult()
    }

    func reportUnsupportedSystemVersion() {
        guard !startupErrorReported else { return }
        startupErrorReported = true
        message = "Apple 翻译需要 macOS 26.4 或更新版本。"
        emit(.failure(code: .unsupportedSystem, message: message))
        terminateAfterShowingResult()
    }

    func run(using session: TranslationSession) async {
        guard !hasStarted, let request else { return }
        hasStarted = true
        let configuration = request.configuration
        let cancellationFileURL = request.cancellationFileURL
        let sessionHandle = TranslationSessionHandle(session)
        let cancellationWatcher = Task { @MainActor in
            while !Task.isCancelled {
                if FileManager.default.fileExists(atPath: cancellationFileURL.path) {
                    sessionHandle.value.cancel()
                    self.cancelSpeechOperation?()
                    return
                }
                try? await Task.sleep(for: .milliseconds(150))
            }
        }
        defer { cancellationWatcher.cancel() }

        do {
            let subtitleURL = try await SubtitleJobPipeline.run(
                configuration: configuration,
                cancellationFileURL: cancellationFileURL,
                prepareTranslation: {
                    try await sessionHandle.value.prepareTranslation()
                },
                transcribe: { [weak self] in
                    guard let self else { throw CancellationError() }
                    let preparedTranscriber = try await self.runSpeechOperation {
                        try await self.prepareTranscriber(request: request, cancellationFileURL: cancellationFileURL)
                    }
                    let workDirectory = FileManager.default.temporaryDirectory
                        .appendingPathComponent("otoha-\(UUID().uuidString)", isDirectory: true)
                    try FileManager.default.createDirectory(at: workDirectory, withIntermediateDirectories: true)
                    defer { try? FileManager.default.removeItem(at: workDirectory) }
                    let audioURL = workDirectory.appendingPathComponent("audio.wav")
                    let sourceTimeOffset = try await FFmpegExtractor.extract(
                        configuration: configuration,
                        outputURL: audioURL,
                        cancellationFileURL: cancellationFileURL,
                        audioFormat: preparedTranscriber.ffmpegFormat
                    ) { event in
                        Task { @MainActor [weak self] in self?.receive(event) }
                    }
                    let recognized = try await self.runSpeechOperation {
                        try await SpeechTranscriptionService.transcribe(
                            audioURL: audioURL,
                            using: preparedTranscriber,
                            cancellationFileURL: cancellationFileURL
                        ) { event in
                            Task { @MainActor [self] in receive(event) }
                        }
                    }
                    return TranscriptionOutput(cues: recognized, sourceTimeOffset: sourceTimeOffset)
                },
                translate: { [weak self] cues in
                    guard let self else { throw CancellationError() }
                    return try await self.translate(
                        cues,
                        using: sessionHandle.value,
                        cancellationFileURL: cancellationFileURL
                    )
                },
                emit: { [weak self] event in
                    Task { @MainActor [weak self] in self?.receive(event) }
                }
            )
            outputURL = subtitleURL
            message = "字幕已生成"
            finished = true
            emit(.completed(path: subtitleURL))
        } catch {
            if isCancelled(cancellationFileURL) || error is CancellationError {
                cancelled = true
                message = "已取消"
                emit(.cancelled())
            } else {
                message = Self.describe(error)
                emit(.failure(code: Self.errorCode(for: error), message: message))
            }
        }
        terminateAfterShowingResult()
    }

    private func prepareTranscriber(request: HelperRequest, cancellationFileURL: URL) async throws -> PreparedSpeechTranscriber {
        try await SpeechTranscriptionService.prepare(
            sourceLanguage: request.sourceLanguage,
            cancellationFileURL: cancellationFileURL
        ) { [weak self] event in
            Task { @MainActor [weak self] in self?.receive(event) }
        }
    }

    private func runSpeechOperation<T>(
        _ operation: @escaping @MainActor () async throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            let task = Task { @MainActor in
                defer { self.cancelSpeechOperation = nil }
                do {
                    continuation.resume(returning: try await operation())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            cancelSpeechOperation = { task.cancel() }
        }
    }

    private func translate(
        _ cues: [TranscribedCue],
        using session: TranslationSession,
        cancellationFileURL: URL
    ) async throws -> [String] {
        message = "正在翻译字幕"
        var translated = try TranslationAccumulator(count: cues.count)
        let batchSize = 64

        for start in stride(from: 0, to: cues.count, by: batchSize) {
            try checkCancellation(cancellationFileURL)
            let end = min(start + batchSize, cues.count)
            let requests = (start..<end).map { index in
                TranslationSession.Request(sourceText: cues[index].source, clientIdentifier: String(index))
            }
            for try await response in session.translate(batch: requests) {
                try translated.record(
                    clientIdentifier: response.clientIdentifier,
                    targetText: response.targetText,
                    batchRange: start..<end
                )
                progress = translated.progress
                emit(.phase(.translating, message: "正在翻译字幕", progress: progress))
            }
        }

        return try translated.finish()
    }

    private func checkCancellation(_ url: URL) throws {
        if FileManager.default.fileExists(atPath: url.path) { throw CancellationError() }
    }

    private func isCancelled(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    private func receive(_ event: HelperEvent) {
        if let message = event.message { self.message = message }
        if let progress = event.progress { self.progress = progress }
        emit(event)
    }

    private func emit(_ event: HelperEvent) {
        do {
            let line = try event.with(jobId: request?.jobId ?? "unknown").jsonLine() + "\n"
            FileHandle.standardOutput.write(Data(line.utf8))
        } catch {
            FileHandle.standardError.write(Data("Otoha event encoding failed: \(error)\n".utf8))
        }
    }

    private static func describe(_ error: Error) -> String {
        let message = error.localizedDescription
        guard ProcessInfo.processInfo.environment["OTOHA_DEBUG_ERRORS"] == "1" else { return message }
        let nsError = error as NSError
        return "\(message) [domain=\(nsError.domain), code=\(nsError.code), userInfo=\(nsError.userInfo)]"
    }

    private static func errorCode(for error: Error) -> HelperErrorCode {
        switch error {
        case JobConfigurationError.ffmpegNotExecutable, FFprobeError.notFound:
            .ffmpegNotFound
        case JobConfigurationError.invalidAudioStream:
            .ffmpegInvalidAudioStream
        case is FFmpegExtractionError:
            .ffmpegExtractionFailed
        case SpeechTranscriptionError.unsupportedLanguage:
            .speechUnsupportedLanguage
        case SpeechTranscriptionError.noAudio:
            .speechNoAudio
        case SpeechTranscriptionError.noSpeech:
            .speechNoSpeech
        case SpeechTranscriptionError.missingAudioFormat:
            .speechMissingFormat
        case SubtitleJobPipelineError.incompleteTranslation:
            .subtitleIncompleteTranslation
        case is ASSOutputError:
            .subtitlePublishFailed
        default:
            .helperUnknown
        }
    }

    private func terminateAfterShowingResult() {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.2))
            NSApplication.shared.terminate(nil)
        }
    }
}

private final class TranslationSessionHandle: @unchecked Sendable {
    let value: TranslationSession

    init(_ value: TranslationSession) {
        self.value = value
    }
}
