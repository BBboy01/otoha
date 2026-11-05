import Foundation
import OtohaCore

enum SubtitleDeletionCLI {
    private struct Request: Decodable {
        let protocolVersion: Int
        let requestId: String
        let mediaPath: String
        let subtitlePath: String
        let outputDirectoryPath: String?
    }
    private struct Response: Encodable {
        let protocolVersion = HelperProtocol.version
        var requestId = ""
        var path: String?
        var code: String?
        var message: String?
    }
    static func run(arguments: [String]) -> Bool {
        guard let index = arguments.firstIndex(of: "--delete-subtitle-json") else { return false }
        var response = Response()
        do {
            guard arguments.indices.contains(index + 1) else { throw SubtitleDeletionError.outsideLibrary }
            let request = try JSONDecoder().decode(Request.self, from: Data(arguments[index + 1].utf8))
            response.requestId = request.requestId
            let paths = [request.mediaPath, request.subtitlePath] + [request.outputDirectoryPath].compactMap { $0 }.filter { !$0.isEmpty }
            guard request.protocolVersion == HelperProtocol.version, !request.requestId.isEmpty,
                  paths.allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else { throw SubtitleDeletionError.outsideLibrary }
            try SubtitleDeletion.remove(
                mediaURL: URL(fileURLWithPath: request.mediaPath),
                rootDirectory: SubtitleLibrary.rootDirectory(configuredPath: request.outputDirectoryPath),
                subtitleURL: URL(fileURLWithPath: request.subtitlePath)
            )
            response.path = request.subtitlePath
        } catch {
            response.code = (error as? SubtitleDeletionError)?.code ?? "subtitle.deleteFailed"
            response.message = (error as? SubtitleDeletionError)?.errorDescription ?? "删除请求无效，请重新打开侧栏后重试。"
        }
        if var data = try? JSONEncoder().encode(response) { data.append(0x0A); FileHandle.standardOutput.write(data) }
        return true
    }
}
