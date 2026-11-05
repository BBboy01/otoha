import Darwin
import Foundation

public enum SubtitleDeletion {
    public static func remove(mediaURL: URL, rootDirectory: URL, subtitleURL: URL) throws {
        let directory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: rootDirectory).standardizedFileURL
        let target = subtitleURL.standardizedFileURL
        guard target.deletingLastPathComponent() == directory,
              directory.resolvingSymlinksInPath() == directory,
              SubtitleFilename.isSubtitle(target, for: mediaURL) else { throw SubtitleDeletionError.outsideLibrary }
        let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw SubtitleDeletionError.failed }
        defer { close(descriptor) }
        var info = stat()
        guard fstatat(descriptor, target.lastPathComponent, &info, AT_SYMLINK_NOFOLLOW) == 0 else {
            throw errno == ENOENT ? SubtitleDeletionError.missing : SubtitleDeletionError.failed
        }
        guard info.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { throw SubtitleDeletionError.outsideLibrary }
        // unlinkat without AT_REMOVEDIR cannot recursively remove a swapped directory.
        guard unlinkat(descriptor, target.lastPathComponent, 0) == 0 else { throw SubtitleDeletionError.failed }
        _ = fsync(descriptor)
    }
}

public enum SubtitleDeletionError: Error, LocalizedError {
    case outsideLibrary, missing, failed
    public var code: String {
        switch self {
        case .outsideLibrary: "subtitle.deleteOutsideLibrary"
        case .missing: "subtitle.deleteMissing"
        case .failed: "subtitle.deleteFailed"
        }
    }
    public var errorDescription: String? {
        switch self {
        case .outsideLibrary: "只能删除当前视频字幕库内的 ASS 文件，不能删除目录或符号链接。"
        case .missing: "字幕文件已不存在。请关闭确认框并刷新字幕列表。"
        case .failed: "无法删除字幕。请检查字幕目录的写入权限后重试。"
        }
    }
}
