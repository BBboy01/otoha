import Foundation

public struct JobCancellationToken: Sendable {
    private let filePath: String?

    public init(cancellationFileURL: URL? = nil) {
        filePath = cancellationFileURL?.path
    }

    public func check() throws {
        if isCancelled {
            throw CancellationError()
        }
    }

    public var isCancelled: Bool {
        Task.isCancelled || (filePath.map { FileManager.default.fileExists(atPath: $0) } ?? false)
    }
}
