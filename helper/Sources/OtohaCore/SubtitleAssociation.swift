import Darwin
import Foundation

public struct SubtitleAssociationEntry: Codable, Sendable {
    public let path: String
    public let name: String
    public let kind: String
    public let modifiedAt: Double
}

public enum SubtitleAssociationError: Error, LocalizedError {
    case invalidPath, invalidSubtitle, unavailable
    public var errorDescription: String? {
        switch self {
        case .invalidPath: "只能选择当前字幕库中的原字幕，不能使用链接或库外文件。"
        case .invalidSubtitle: "所选文件不是有效的 Otoha 字幕。"
        case .unavailable: "无法关联字幕，请检查字幕库的读取与写入权限。"
        }
    }
}

public enum SubtitleAssociation {
    public static func browse(rootDirectory: URL, directoryURL: URL? = nil) throws -> [SubtitleAssociationEntry] {
        guard FileManager.default.fileExists(atPath: rootDirectory.path) else { return [] }
        let root = try openRoot(rootDirectory)
        defer { close(root) }
        let directory: Int32
        if let directoryURL {
            let name = try directoryName(directoryURL, rootDirectory: rootDirectory)
            directory = openat(root, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
            guard directory >= 0 else { throw SubtitleAssociationError.invalidPath }
        } else { directory = dup(root) }
        defer { close(directory) }
        guard let stream = fdopendir(dup(directory)) else { throw SubtitleAssociationError.unavailable }
        defer { closedir(stream) }
        var entries: [SubtitleAssociationEntry] = []
        while let entry = readdir(stream) {
            let name = withUnsafePointer(to: entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
            }
            guard !name.hasPrefix(".") else { continue }
            var info = stat()
            guard fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW) == 0 else { continue }
            let isDirectory = (info.st_mode & S_IFMT) == S_IFDIR
            if directoryURL == nil {
                guard isDirectory, validDirectoryName(name) else { continue }
            } else {
                guard (info.st_mode & S_IFMT) == S_IFREG,
                      validSubtitleName(name, directoryName: directoryURL!.lastPathComponent) else { continue }
            }
            entries.append(.init(path: (directoryURL ?? rootDirectory).appendingPathComponent(name).path,
                                 name: name, kind: isDirectory ? "directory" : "subtitle",
                                 modifiedAt: Double(info.st_mtimespec.tv_sec) * 1000))
        }
        return entries.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    public static func copy(subtitleURL: URL, mediaURL: URL, rootDirectory: URL) throws -> URL {
        guard mediaURL.isFileURL, mediaURL.path.hasPrefix("/"), !mediaURL.path.contains("\0") else {
            throw SubtitleAssociationError.invalidPath
        }
        let root = try openRoot(rootDirectory)
        defer { close(root) }
        let sourceDirectory = subtitleURL.deletingLastPathComponent()
        let directoryName = try directoryName(sourceDirectory, rootDirectory: rootDirectory)
        guard subtitleURL.standardizedFileURL == subtitleURL,
              validSubtitleName(subtitleURL.lastPathComponent, directoryName: directoryName) else {
            throw SubtitleAssociationError.invalidPath
        }
        let sourceDir = openat(root, directoryName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard sourceDir >= 0 else { throw SubtitleAssociationError.invalidPath }
        defer { close(sourceDir) }
        let source = openat(sourceDir, subtitleURL.lastPathComponent, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard source >= 0 else { throw SubtitleAssociationError.invalidPath }
        defer { close(source) }
        let data = try readSubtitle(source)
        guard let content = String(data: data, encoding: .utf8), (try? ASSEditDocument(content)) != nil else {
            throw SubtitleAssociationError.invalidSubtitle
        }
        let targetURL = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: rootDirectory)
        let targetName = targetURL.lastPathComponent
        if mkdirat(root, targetName, S_IRUSR | S_IWUSR | S_IXUSR) != 0, errno != EEXIST {
            throw SubtitleAssociationError.unavailable
        }
        let targetDir = openat(root, targetName, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard targetDir >= 0 else { throw SubtitleAssociationError.invalidPath }
        defer { close(targetDir) }
        let temporaryName = ".otoha-association-\(UUID().uuidString).tmp"
        let output = openat(targetDir, temporaryName, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard output >= 0 else { throw SubtitleAssociationError.unavailable }
        defer { close(output); unlinkat(targetDir, temporaryName, 0) }
        try data.withUnsafeBytes { bytes in
            var written = 0
            while written < bytes.count {
                let count = write(output, bytes.baseAddress!.advanced(by: written), bytes.count - written)
                if count < 0, errno == EINTR { continue }
                guard count > 0 else { throw SubtitleAssociationError.unavailable }
                written += count
            }
        }
        guard fsync(output) == 0 else { throw SubtitleAssociationError.unavailable }
        let originalBase = String(directoryName.dropLast(17))
        let stem = subtitleURL.deletingPathExtension().lastPathComponent
            .replacingOccurrences(of: " \\([0-9]+\\)$", with: "", options: .regularExpression)
        let suffix = stem.dropFirst(originalBase.count)
        let base = SubtitleFilename.mediaBaseName(for: mediaURL) + suffix
        for version in 1...10_000 {
            let name = base + (version == 1 ? "" : " (\(version))") + ".ass"
            guard SubtitleFilename.isSubtitle(targetURL.appendingPathComponent(name), for: mediaURL) else {
                throw SubtitleAssociationError.invalidSubtitle
            }
            if linkat(targetDir, temporaryName, targetDir, name, 0) == 0 {
                _ = fsync(targetDir)
                return targetURL.appendingPathComponent(name)
            }
            guard errno == EEXIST else { throw SubtitleAssociationError.unavailable }
        }
        throw SubtitleAssociationError.unavailable
    }

    private static func openRoot(_ root: URL) throws -> Int32 {
        guard root.isFileURL, root.path.hasPrefix("/"), !root.path.contains("\0") else {
            throw SubtitleAssociationError.invalidPath
        }
        let descriptor = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw SubtitleAssociationError.invalidPath }
        return descriptor
    }

    private static func directoryName(_ directory: URL, rootDirectory: URL) throws -> String {
        guard directory.standardizedFileURL == directory,
              directory.deletingLastPathComponent().standardizedFileURL == rootDirectory.standardizedFileURL,
              validDirectoryName(directory.lastPathComponent) else { throw SubtitleAssociationError.invalidPath }
        return directory.lastPathComponent
    }

    private static func validDirectoryName(_ name: String) -> Bool {
        name.count > 17 && name.dropLast(16).hasSuffix("-") && name.suffix(16).allSatisfy { $0.isHexDigit && $0.isASCII }
    }

    private static func validSubtitleName(_ name: String, directoryName: String) -> Bool {
        guard validDirectoryName(directoryName) else { return false }
        let media = URL(fileURLWithPath: "/" + String(directoryName.dropLast(17)) + ".mp4")
        return SubtitleFilename.isSubtitle(URL(fileURLWithPath: "/" + name), for: media)
    }

    private static func readSubtitle(_ descriptor: Int32) throws -> Data {
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size <= ASSEditStore.maximumBytes else { throw SubtitleAssociationError.invalidSubtitle }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = buffer.withUnsafeMutableBytes { read(descriptor, $0.baseAddress, $0.count) }
            if count == 0 { return data }
            if count < 0, errno == EINTR { continue }
            guard count > 0, data.count + count <= ASSEditStore.maximumBytes else { throw SubtitleAssociationError.invalidSubtitle }
            data.append(contentsOf: buffer.prefix(count))
        }
    }
}
