import Darwin
import Foundation

public enum SRTOutput {
    public static func publish(
        _ cues: [SubtitleCue],
        baseName: String,
        directory: URL,
        cancellationFileURL: URL? = nil
    ) throws -> URL {
        try publish(cues, baseName: baseName, directory: directory) {
            cancellationFileURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
        }
    }

    static func publish(
        _ cues: [SubtitleCue],
        baseName: String,
        directory: URL,
        isCancelled: () -> Bool
    ) throws -> URL {
        try checkCancellation(isCancelled)
        let content = Data(try SRTWriter.serialize(cues).utf8)
        let safeBaseName = sanitizedBaseName(baseName)
        let temporaryURL = directory.appendingPathComponent(".otoha-\(UUID().uuidString).tmp")
        try writeExclusive(content, to: temporaryURL)
        defer { _ = unlink(temporaryURL.path) }

        for index in 1...10_000 {
            try checkCancellation(isCancelled)
            let suffix = index == 1 ? "" : " (\(index))"
            let destination = directory.appendingPathComponent("\(safeBaseName)\(suffix).srt")
            if link(temporaryURL.path, destination.path) == 0 {
                if isCancelled() {
                    guard unlink(destination.path) == 0 else {
                        throw SRTOutputError.publishFailed(String(cString: strerror(errno)))
                    }
                    syncDirectory(directory)
                    throw SRTOutputError.cancelled
                }
                syncDirectory(directory)
                return destination
            }
            if errno != EEXIST { throw SRTOutputError.publishFailed(String(cString: strerror(errno))) }
        }
        throw SRTOutputError.tooManyCollisions
    }

    private static func checkCancellation(_ isCancelled: () -> Bool) throws {
        if isCancelled() { throw SRTOutputError.cancelled }
    }

    private static func sanitizedBaseName(_ value: String) -> String {
        let cleaned = value
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty || cleaned == "." || cleaned == ".." ? "Subtitle" : cleaned
    }

    private static func writeExclusive(_ data: Data, to url: URL) throws {
        let descriptor = open(url.path, O_WRONLY | O_CREAT | O_EXCL, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw SRTOutputError.publishFailed(String(cString: strerror(errno))) }
        var writeSucceeded = false
        defer { _ = close(descriptor) }
        defer {
            if !writeSucceeded { _ = unlink(url.path) }
        }

        try data.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return }
            var written = 0
            while written < bytes.count {
                let result = write(descriptor, baseAddress.advanced(by: written), bytes.count - written)
                if result < 0 {
                    if errno == EINTR { continue }
                    throw SRTOutputError.publishFailed(String(cString: strerror(errno)))
                }
                written += result
            }
        }
        guard fsync(descriptor) == 0 else { throw SRTOutputError.publishFailed(String(cString: strerror(errno))) }
        writeSucceeded = true
    }

    private static func syncDirectory(_ directory: URL) {
        let descriptor = open(directory.path, O_RDONLY)
        guard descriptor >= 0 else { return }
        _ = fsync(descriptor)
        _ = close(descriptor)
    }
}

public enum SRTOutputError: Error, Equatable, LocalizedError {
    case cancelled
    case publishFailed(String)
    case tooManyCollisions

    public var errorDescription: String? {
        switch self {
        case .cancelled: "字幕保存已取消。"
        case let .publishFailed(reason): "无法保存字幕：\(reason)"
        case .tooManyCollisions: "已有太多字幕文件使用这个名称。"
        }
    }
}
