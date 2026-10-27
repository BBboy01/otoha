import AVFoundation
import CoreMedia
import Foundation
import OtohaCore
import Speech

struct PreparedSpeechTranscriber {
    let transcriber: SpeechTranscriber
    let analyzerFormat: AVAudioFormat
    let ffmpegFormat: AudioFormatSpecification
}

enum SpeechTranscriptionError: Error, LocalizedError {
    case unsupportedLanguage(String)
    case noAudio
    case noSpeech
    case missingAudioFormat

    var errorDescription: String? {
        switch self {
        case let .unsupportedLanguage(language): "这台 Mac 不支持用 \(language) 转录语音。"
        case .noAudio: "所选音轨没有可用音频。"
        case .noSpeech: "所选音轨中没有识别到语音。"
        case .missingAudioFormat: "已安装的语音模型没有兼容的音频格式。"
        }
    }
}

enum SpeechTranscriptionService {
    static func prepare(
        sourceLanguage: String,
        cancellationFileURL: URL,
        emit: @escaping @Sendable (HelperEvent) -> Void
    ) async throws -> PreparedSpeechTranscriber {
        try checkCancellation(cancellationFileURL)
        let requestedLocale = Locale(identifier: sourceLanguage)
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
            throw SpeechTranscriptionError.unsupportedLanguage(sourceLanguage)
        }
        try checkCancellation(cancellationFileURL)
        let transcriber = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: [.audioTimeRange]
        )
        if let installationRequest = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try checkCancellation(cancellationFileURL)
            let progressTask = Task {
                while !Task.isCancelled {
                    let fraction = installationRequest.progress.fractionCompleted
                    let progress = fraction.isFinite ? min(max(fraction, 0), 1) : nil
                    emit(.phase(.preparingLanguageResources, message: "正在下载语音模型", progress: progress))
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
            defer { progressTask.cancel() }
            try await withTaskCancellationHandler {
                try await installationRequest.downloadAndInstall()
            } onCancel: {
                installationRequest.progress.cancel()
            }
            try checkCancellation(cancellationFileURL)
        }
        let preferredFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
        guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber],
            considering: preferredFormat
        ) else {
            throw SpeechTranscriptionError.missingAudioFormat
        }
        try checkCancellation(cancellationFileURL)
        return PreparedSpeechTranscriber(
            transcriber: transcriber,
            analyzerFormat: analyzerFormat,
            ffmpegFormat: try AudioFormatSpecification(analyzerFormat: analyzerFormat)
        )
    }

    static func transcribe(
        audioURL: URL,
        using prepared: PreparedSpeechTranscriber,
        cancellationFileURL: URL,
        emit: @Sendable (HelperEvent) -> Void
    ) async throws -> [TranscribedCue] {
        let transcriber = prepared.transcriber
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let audioFile = try AVAudioFile(forReading: audioURL)
        emit(.phase(.transcribing, message: "正在使用本机转录语音"))

        let resultsTask = Task { () throws -> [TranscribedCue] in
            var cues: [TranscribedCue] = []
            for try await result in transcriber.results {
                guard result.isFinal else { continue }
                let start = CMTimeGetSeconds(result.range.start)
                let end = CMTimeGetSeconds(CMTimeRangeGetEnd(result.range))
                let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    cues.append(TranscribedCue(start: start, end: end, source: text))
                }
            }
            return cues
        }

        do {
            try await withTaskCancellationHandler {
                try checkCancellation(cancellationFileURL)
                guard let lastSampleTime = try await analyzer.analyzeSequence(from: audioFile) else {
                    throw SpeechTranscriptionError.noAudio
                }
                try checkCancellation(cancellationFileURL)
                try await analyzer.finalizeAndFinish(through: lastSampleTime)
            } onCancel: {
                Task { await analyzer.cancelAndFinishNow() }
            }
            let cues = try await resultsTask.value
            guard !cues.isEmpty else { throw SpeechTranscriptionError.noSpeech }
            return cues
        } catch {
            await analyzer.cancelAndFinishNow()
            resultsTask.cancel()
            throw error
        }
    }

    private static func checkCancellation(_ url: URL) throws {
        if Task.isCancelled || FileManager.default.fileExists(atPath: url.path) {
            throw CancellationError()
        }
    }
}

private extension AudioFormatSpecification {
    init(analyzerFormat: AVAudioFormat) throws {
        let codec: String
        switch analyzerFormat.commonFormat {
        case .pcmFormatInt16: codec = "pcm_s16le"
        case .pcmFormatInt32: codec = "pcm_s32le"
        case .pcmFormatFloat32: codec = "pcm_f32le"
        case .pcmFormatFloat64: codec = "pcm_f64le"
        case .otherFormat: throw SpeechTranscriptionError.missingAudioFormat
        @unknown default: throw SpeechTranscriptionError.missingAudioFormat
        }
        self.init(
            sampleRate: Int(analyzerFormat.sampleRate.rounded()),
            channelCount: Int(analyzerFormat.channelCount),
            codec: codec
        )
    }
}
