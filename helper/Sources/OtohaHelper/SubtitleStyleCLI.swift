import Foundation
import OtohaCore

enum SubtitleStyleCLI {
    private struct Request: Decodable {
        let content: String
        let style: SubtitleStyle
    }

    static func run(arguments: [String]) -> Bool {
        guard let index = arguments.firstIndex(of: "--style-subtitle-file") else { return false }
        do {
            guard arguments.indices.contains(index + 2) else { throw ASSEditError.invalidDocument }
            let input = try temporaryURL(arguments[index + 1], prefix: "otoha-style-input-")
            let output = try temporaryURL(arguments[index + 2], prefix: "otoha-style-output-")
            guard try input.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max <= ASSEditStore.maximumBytes * 2 else {
                throw ASSEditError.tooLarge
            }
            let data = try Data(contentsOf: input)
            guard data.count <= ASSEditStore.maximumBytes * 2 else { throw ASSEditError.tooLarge }
            let request = try JSONDecoder().decode(Request.self, from: data)
            let content = try request.style.applying(to: request.content)
            guard content.utf8.count <= ASSEditStore.maximumBytes else { throw ASSEditError.tooLarge }
            try Data(content.utf8).write(to: output, options: .atomic)
        } catch {
            FileHandle.standardError.write(Data("字幕样式应用失败：\(error.localizedDescription)\n".utf8))
            exit(EXIT_FAILURE)
        }
        return true
    }

    private static func temporaryURL(_ path: String, prefix: String) throws -> URL {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().path + "/"
        guard path.hasPrefix("/"), url.lastPathComponent.hasPrefix(prefix),
              url.pathExtension == "json", url.resolvingSymlinksInPath().path.hasPrefix(root) else {
            throw ASSEditError.outsideLibrary
        }
        return url
    }
}
