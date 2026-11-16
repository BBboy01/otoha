import Foundation
import Darwin

public enum TranslationInputStore {
    public static func read(configuration: JobConfiguration) throws -> TranscriptionOutput {
        guard let url = configuration.inputSubtitleURL, url.isFileURL,
              url.resolvingSymlinksInPath() == url.standardizedFileURL else { throw ImportError.outsideLibrary }
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        guard descriptor >= 0 else { throw ImportError.invalidEncoding }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(descriptor, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size <= SRTImporter.maximumBytes else { throw ImportError.invalidEncoding }
        let data = try handle.read(upToCount: SRTImporter.maximumBytes + 1) ?? Data()
        guard data.count <= SRTImporter.maximumBytes else { throw ImportError.invalidEncoding }
        let cues: [TranscribedCue]
        if url.pathExtension.lowercased() == "srt" {
            cues = try SRTImporter.parse(data)
        } else {
            guard url.pathExtension.lowercased() == "ass",
                  url.deletingLastPathComponent() == configuration.outputDirectory.standardizedFileURL,
                  SubtitleFilename.isSubtitle(url, for: configuration.mediaURL) else { throw ImportError.outsideLibrary }
            guard let content = String(data: data, encoding: .utf8) else { throw ImportError.invalidEncoding }
            cues = try ASSEditDocument(content).cues.map { .init(start: $0.start, end: $0.end, source: $0.source) }
        }
        return TranscriptionOutput(cues: cues, sourceTimeOffset: 0)
    }
}
