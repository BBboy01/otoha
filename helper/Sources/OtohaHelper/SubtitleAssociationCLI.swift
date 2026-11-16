import Foundation
import OtohaCore

enum SubtitleAssociationCLI {
    private struct Request: Decodable {
        let protocolVersion: Int
        let requestId: String
        let outputDirectoryPath: String?
        let directoryPath: String?
        let subtitlePath: String?
        let mediaPath: String?
    }
    private struct Response: Encodable {
        let protocolVersion = HelperProtocol.version
        var requestId = ""
        var entries: [SubtitleAssociationEntry]?
        var path: String?
        var code: String?
        var message: String?
    }
    static func run(arguments: [String]) -> Bool {
        let browse = arguments.firstIndex(of: "--browse-subtitles-json")
        let copy = arguments.firstIndex(of: "--associate-subtitle-json")
        guard let index = browse ?? copy else { return false }
        var response = Response()
        do {
            guard arguments.indices.contains(index + 1), browse == nil || copy == nil else { throw SubtitleAssociationError.invalidPath }
            let request = try JSONDecoder().decode(Request.self, from: Data(arguments[index + 1].utf8))
            response.requestId = request.requestId
            let paths = [request.outputDirectoryPath, request.directoryPath, request.subtitlePath, request.mediaPath].compactMap { $0 }
            guard request.protocolVersion == HelperProtocol.version, !request.requestId.isEmpty,
                  paths.allSatisfy({ ($0.isEmpty || $0.hasPrefix("/")) && !$0.contains("\0") }) else {
                throw SubtitleAssociationError.invalidPath
            }
            let root = SubtitleLibrary.rootDirectory(configuredPath: request.outputDirectoryPath)
            if browse != nil {
                response.entries = try SubtitleAssociation.browse(rootDirectory: root,
                    directoryURL: request.directoryPath.flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) })
            } else {
                guard let source = request.subtitlePath, let media = request.mediaPath,
                      !source.isEmpty, !media.isEmpty else { throw SubtitleAssociationError.invalidPath }
                response.path = try SubtitleAssociation.copy(subtitleURL: URL(fileURLWithPath: source),
                    mediaURL: URL(fileURLWithPath: media), rootDirectory: root).path
            }
        } catch {
            response.code = "subtitle.associationFailed"
            response.message = (error as? SubtitleAssociationError)?.errorDescription ?? "关联请求无效，请重新选择字幕。"
        }
        if var data = try? JSONEncoder().encode(response) {
            data.append(0x0A); FileHandle.standardOutput.write(data)
        }
        return true
    }
}
