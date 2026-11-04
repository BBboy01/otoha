import Foundation

public enum LanguageResourceStatus: String, Codable, Sendable {
    case unsupported, supported, downloading, installed
}

public struct LanguagePreflightRequest: Codable, Sendable {
    public let protocolVersion: Int
    public let requestId: String
    public let sourceLanguage: String
    public let targetLanguage: String

    public init(requestId: String, sourceLanguage: String, targetLanguage: String) {
        protocolVersion = HelperProtocol.version
        self.requestId = requestId
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
    }

    public func validate() throws {
        guard protocolVersion == HelperProtocol.version,
              !requestId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw JobConfigurationError.invalidLanguages
        }
        try JobConfiguration.validateLanguages(source: sourceLanguage, target: targetLanguage)
    }
}

public struct LanguagePreflightResult: Encodable, Sendable {
    public let protocolVersion = HelperProtocol.version
    public let requestId: String
    public let sourceLanguage: String
    public let targetLanguage: String
    public let speech: LanguageResourceStatus
    public let translation: LanguageResourceStatus
    public let errorCode: HelperErrorCode?
    public let message: String
    public var canGenerate: Bool { errorCode == nil }

    public init(requestId: String, sourceLanguage: String, targetLanguage: String,
                speech: LanguageResourceStatus, translation: LanguageResourceStatus) {
        self.requestId = requestId
        self.sourceLanguage = sourceLanguage
        self.targetLanguage = targetLanguage
        self.speech = speech
        self.translation = translation
        if speech == .unsupported {
            errorCode = .speechUnsupportedLanguage
            message = "这台 Mac 不支持用 \(sourceLanguage) 转录。请选择其他源语言。"
        } else if translation == .unsupported {
            errorCode = .translationUnsupportedLanguage
            message = "这台 Mac 不支持所选翻译语言对。请选择其他语言。"
        } else if translation != .installed {
            errorCode = .translationResourcesMissing
            message = "翻译资源尚未安装。请通过 macOS 的翻译功能下载源语言和目标语言，再重新检查。"
        } else {
            errorCode = nil
            message = speech == .installed ? "语言资源可用" : "翻译资源可用；生成时准备语音模型，macOS 可能要求下载资源。"
        }
    }
}

public struct LanguagePreflightFailure: Error, LocalizedError, Sendable {
    public let result: LanguagePreflightResult
    public init(_ result: LanguagePreflightResult) { self.result = result }
    public var errorDescription: String? { result.message }
}
