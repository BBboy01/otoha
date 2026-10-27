import Foundation

public struct TranslationAccumulator: Sendable {
    private var translations: [String?]

    public init(count: Int) throws {
        guard count > 0 else { throw TranslationAccumulatorError.noResults }
        translations = Array(repeating: nil, count: count)
    }

    public var completedCount: Int {
        translations.compactMap { $0 }.count
    }

    public var progress: Double {
        Double(completedCount) / Double(translations.count)
    }

    public mutating func record(
        clientIdentifier: String?,
        targetText: String,
        batchRange: Range<Int>
    ) throws {
        guard let clientIdentifier,
              let index = Int(clientIdentifier),
              translations.indices.contains(index),
              batchRange.contains(index) else {
            throw TranslationAccumulatorError.invalidResponse
        }
        translations[index] = targetText
    }

    public func finish() throws -> [String] {
        let values = translations.compactMap { $0 }
        guard values.count == translations.count,
              values.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
            throw TranslationAccumulatorError.incompleteTranslation
        }
        return values
    }
}

public enum TranslationAccumulatorError: Error, Equatable, LocalizedError {
    case noResults
    case invalidResponse
    case incompleteTranslation

    public var errorDescription: String? {
        switch self {
        case .noResults: "没有可供翻译的语音内容。"
        case .invalidResponse: "Apple 翻译返回了无法匹配的字幕标识。"
        case .incompleteTranslation: "翻译没有完成所有字幕。"
        }
    }
}
