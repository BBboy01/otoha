import Darwin
import Foundation

public enum SRTExportStore {
    private static let maximumASSSize = 16 * 1024 * 1024

    public static func write(
        subtitleURL: URL,
        mediaURL: URL,
        libraryRoot: URL,
        destinationDirectory: URL,
        mode: SRTExportMode
    ) throws -> URL {
        let expectedDirectory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: libraryRoot)
            .standardizedFileURL.path
        let source = subtitleURL.standardizedFileURL
        guard source.deletingLastPathComponent().path == expectedDirectory,
              SubtitleFilename.isSubtitle(source, for: mediaURL) else {
            throw SRTExportStoreError.subtitleOutsideLibrary
        }

        let sourceDescriptor = open(source.path, O_RDONLY | O_NOFOLLOW)
        guard sourceDescriptor >= 0 else { throw SRTExportStoreError.readFailed(errno) }
        let assData: Data
        do {
            assData = try readASS(from: sourceDescriptor)
        } catch {
            close(sourceDescriptor)
            throw error
        }
        close(sourceDescriptor)

        guard let ass = String(data: assData, encoding: .utf8) else { throw SRTExportStoreError.invalidEncoding }
        let contents = Data(try SRTExporter.export(ass, mode: mode).utf8)
        let directory = destinationDirectory.standardizedFileURL
        var directoryInfo = stat()
        guard lstat(directory.path, &directoryInfo) == 0,
              (directoryInfo.st_mode & S_IFMT) == S_IFDIR else {
            throw SRTExportStoreError.destinationUnavailable(errno)
        }
        let directoryDescriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard directoryDescriptor >= 0 else { throw SRTExportStoreError.destinationUnavailable(errno) }
        defer { close(directoryDescriptor) }

        let modeName: String
        switch mode {
        case .source: modeName = "Source"
        case .translation: modeName = "Translation"
        case .bilingual: modeName = "Bilingual"
        }
        let base = "\(SubtitleFilename.mediaBaseName(for: mediaURL)) [\(modeName)]"
        for version in 1...Int.max {
            let suffix = version == 1 ? "" : " (\(version))"
            let name = "\(base)\(suffix).srt"
            let outputDescriptor = openat(
                directoryDescriptor,
                name,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW,
                S_IRUSR | S_IWUSR
            )
            if outputDescriptor < 0 {
                if errno == EEXIST { continue }
                throw SRTExportStoreError.writeFailed(errno)
            }
            do {
                try write(contents, to: outputDescriptor)
                guard fsync(outputDescriptor) == 0 else { throw SRTExportStoreError.writeFailed(errno) }
                guard fsync(directoryDescriptor) == 0 else { throw SRTExportStoreError.writeFailed(errno) }
                close(outputDescriptor)
                return directory.appendingPathComponent(name)
            } catch {
                close(outputDescriptor)
                _ = unlinkat(directoryDescriptor, name, 0)
                throw error
            }
        }
        throw SRTExportStoreError.writeFailed(EEXIST)
    }

    private static func readASS(from descriptor: Int32) throws -> Data {
        var info = stat()
        guard fstat(descriptor, &info) == 0 else {
            throw SRTExportStoreError.sourceUnavailable(errno)
        }
        guard (info.st_mode & S_IFMT) == S_IFREG else { throw SRTExportStoreError.sourceUnavailable(EINVAL) }
        guard info.st_size <= maximumASSSize else { throw SRTExportStoreError.sourceTooLarge }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { read(descriptor, $0.baseAddress, $0.count) }
            if count == 0 { return data }
            if count < 0 {
                if errno == EINTR { continue }
                throw SRTExportStoreError.readFailed(errno)
            }
            guard data.count + count <= maximumASSSize else { throw SRTExportStoreError.sourceTooLarge }
            data.append(contentsOf: buffer.prefix(count))
        }
    }

    private static func write(_ data: Data, to descriptor: Int32) throws {
        try data.withUnsafeBytes { buffer in
            guard let base = buffer.baseAddress else { return }
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, base.advanced(by: offset), buffer.count - offset)
                if count < 0 {
                    if errno == EINTR { continue }
                    throw SRTExportStoreError.writeFailed(errno)
                }
                guard count > 0 else { throw SRTExportStoreError.writeFailed(EIO) }
                offset += count
            }
        }
    }
}

public enum SRTExportStoreError: Error, Equatable, LocalizedError {
    case subtitleOutsideLibrary
    case sourceUnavailable(Int32)
    case sourceTooLarge
    case invalidEncoding
    case readFailed(Int32)
    case destinationUnavailable(Int32)
    case writeFailed(Int32)

    public var errorDescription: String? {
        switch self {
        case .subtitleOutsideLibrary: "所选 ASS 不在当前视频的 Otoha 字幕库中。"
        case .sourceUnavailable: "无法读取所选 ASS 文件，请检查文件权限和字幕库路径。"
        case .sourceTooLarge: "ASS 文件超过 16 MB，无法导出。"
        case .invalidEncoding: "ASS 文件不是有效的 UTF-8 文本。"
        case .readFailed: "读取 ASS 文件失败，请检查文件权限。"
        case .destinationUnavailable: "无法访问所选导出目录，请选择一个可写文件夹。"
        case .writeFailed: "SRT 导出失败，请检查导出目录的写入权限。"
        }
    }
}
