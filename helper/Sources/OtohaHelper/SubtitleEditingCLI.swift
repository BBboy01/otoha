import Foundation
import OtohaCore

enum SubtitleEditingCLI {
    private enum RequestError: Error, LocalizedError {
        case invalidRequest
        var errorDescription: String? { "字幕校对请求无效，请重新打开侧栏后重试。" }
    }
    private struct Request: Decodable {
        let protocolVersion: Int
        let requestId: String
        let mediaPath: String
        let subtitlePath: String
        let outputDirectoryPath: String?
        let revision: String?
        let texts: [ASSEditText]?

        func validate() throws {
            guard protocolVersion == HelperProtocol.version, !requestId.isEmpty,
                  mediaPath.hasPrefix("/"), subtitlePath.hasPrefix("/"),
                  outputDirectoryPath.map({ $0.isEmpty || $0.hasPrefix("/") }) ?? true else {
                throw RequestError.invalidRequest
            }
        }
    }

    private struct Response: Encodable {
        let protocolVersion = HelperProtocol.version
        let requestId: String
        let snapshot: ASSEditSnapshot?
        let code: String?
        let message: String?
    }

    static func run(arguments: [String]) -> Bool {
        let readIndex = arguments.firstIndex(of: "--read-subtitle-json")
        let saveIndex = arguments.firstIndex(of: "--save-subtitle-file")
        guard let index = readIndex ?? saveIndex else { return false }
        var requestId = "unknown"
        let response: Response
        do {
            guard arguments.indices.contains(index + 1), readIndex == nil || saveIndex == nil else { throw RequestError.invalidRequest }
            let data: Data
            if saveIndex != nil {
                let url = URL(fileURLWithPath: arguments[index + 1])
                guard arguments[index + 1].hasPrefix("/"), url.lastPathComponent.hasPrefix("otoha-edit-"),
                      url.pathExtension == "json",
                      try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max <= ASSEditStore.maximumBytes * 2 else {
                    throw ASSEditError.tooLarge
                }
                data = try Data(contentsOf: url)
            } else { data = Data(arguments[index + 1].utf8) }
            guard data.count <= ASSEditStore.maximumBytes * 2 else { throw ASSEditError.tooLarge }
            let request = try JSONDecoder().decode(Request.self, from: data)
            requestId = request.requestId
            try request.validate()
            let media = URL(fileURLWithPath: request.mediaPath)
            let subtitle = URL(fileURLWithPath: request.subtitlePath)
            let root = SubtitleLibrary.rootDirectory(configuredPath: request.outputDirectoryPath)
            let snapshot: ASSEditSnapshot
            if saveIndex != nil {
                guard let revision = request.revision, let texts = request.texts else { throw ASSEditError.invalidEdits }
                snapshot = try ASSEditStore.save(mediaURL: media, rootDirectory: root, subtitleURL: subtitle,
                                                 revision: revision, texts: texts)
            } else {
                snapshot = try ASSEditStore.read(mediaURL: media, rootDirectory: root, subtitleURL: subtitle)
            }
            response = Response(requestId: requestId, snapshot: snapshot, code: nil, message: nil)
        } catch {
            response = Response(requestId: requestId, snapshot: nil,
                code: (error as? ASSEditError)?.code ?? (error is RequestError || error is DecodingError ? "helper.invalidRequest" : "subtitle.publishFailed"),
                message: error is DecodingError ? RequestError.invalidRequest.localizedDescription : error.localizedDescription)
        }
        do {
            var data = try JSONEncoder().encode(response)
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
        } catch {
            FileHandle.standardError.write(Data("字幕校对响应失败：\(error.localizedDescription)\n".utf8))
        }
        return true
    }
}
