import Foundation

public enum HelperProtocol {
    public static let version = 1
}

public enum HelperErrorCode: String, Codable, Sendable {
    case invalidRequest = "helper.invalidRequest"
    case unsupportedSystem = "helper.unsupportedSystem"
    case helperUnknown = "helper.unknown"
    case ffmpegNotFound = "ffmpeg.notFound"
    case ffmpegInvalidAudioStream = "ffmpeg.invalidAudioStream"
    case ffmpegExtractionFailed = "ffmpeg.extractionFailed"
    case speechUnsupportedLanguage = "speech.unsupportedLanguage"
    case speechNoAudio = "speech.noAudio"
    case speechNoSpeech = "speech.noSpeech"
    case speechMissingFormat = "speech.missingFormat"
    case translationFailed = "translation.failed"
    case subtitleIncompleteTranslation = "subtitle.incompleteTranslation"
    case subtitlePublishFailed = "subtitle.publishFailed"
    case subtitleLoadFailed = "subtitle.loadFailed"
    case jobCancelled = "job.cancelled"
}

public enum JobPhase: String, Codable, Sendable {
    case checkingEnvironment
    case preparingLanguageResources
    case extractingAudio
    case transcribing
    case translating
    case saving
    case loading
}

public struct HelperEvent: Codable, Sendable {
    public let protocolVersion: Int
    public let type: String
    public let jobId: String?
    public let phase: String?
    public let code: HelperErrorCode?
    public let message: String?
    public let progress: Double?
    public let path: String?

    private init(
        protocolVersion: Int = HelperProtocol.version,
        type: String,
        jobId: String? = nil,
        phase: String? = nil,
        code: HelperErrorCode? = nil,
        message: String? = nil,
        progress: Double? = nil,
        path: String? = nil
    ) {
        self.protocolVersion = protocolVersion
        self.type = type
        self.jobId = jobId
        self.phase = phase
        self.code = code
        self.message = message
        self.progress = progress
        self.path = path
    }

    public static func phase(_ phase: JobPhase, jobId: String? = nil, message: String? = nil, progress: Double? = nil) -> Self {
        Self(type: "phase", jobId: jobId, phase: phase.rawValue, message: message, progress: progress)
    }

    public static func completed(path: URL, jobId: String? = nil) -> Self {
        Self(type: "completed", jobId: jobId, path: path.path)
    }

    public static func cancelled(jobId: String? = nil) -> Self {
        Self(type: "cancelled", jobId: jobId, code: .jobCancelled)
    }

    public static func failure(code: HelperErrorCode = .helperUnknown, jobId: String? = nil, message: String) -> Self {
        Self(type: "error", jobId: jobId, code: code, message: message)
    }

    public func with(jobId: String?) -> Self {
        Self(
            protocolVersion: protocolVersion,
            type: type,
            jobId: jobId,
            phase: phase,
            code: code,
            message: message,
            progress: progress,
            path: path
        )
    }

    public func jsonLine() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

public typealias HelperEventPayload = HelperEvent
