import AppKit
import Foundation
import UniformTypeIdentifiers

@MainActor
enum SubtitleImportPickerCLI {
    private enum SelectionError: Error, LocalizedError {
        case invalidFile
        var errorDescription: String? { "请选择不超过 16 MB 的 UTF-8 SRT 字幕文件。" }
    }

    static func run(
        arguments: [String],
        choose: @MainActor () throws -> URL? = chooseFile,
        emit: (Data) -> Void = { FileHandle.standardOutput.write($0) }
    ) -> Bool {
        guard arguments.contains("--choose-subtitle-json") else { return false }
        var response: [String: Any] = ["path": NSNull()]
        do {
            if let selected = try choose() {
                let url = selected.standardizedFileURL
                guard url.isFileURL, url.pathExtension.lowercased() == "srt" else { throw SelectionError.invalidFile }
                let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard properties.isRegularFile == true, let size = properties.fileSize,
                      size <= 16 * 1024 * 1024 else { throw SelectionError.invalidFile }
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                guard data.count <= 16 * 1024 * 1024, String(data: data, encoding: .utf8) != nil else {
                    throw SelectionError.invalidFile
                }
                response["path"] = url.path
            }
        } catch {
            response["message"] = error.localizedDescription
        }
        if var data = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]) {
            data.append(0x0A)
            emit(data)
        }
        return true
    }

    private static func chooseFile() -> URL? {
        let application = NSApplication.shared
        let previousPolicy = application.activationPolicy()
        application.setActivationPolicy(.accessory)
        let panel = NSOpenPanel()
        panel.title = "导入原文字幕"
        panel.prompt = "选择字幕"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [UTType(filenameExtension: "srt") ?? .plainText]
        panel.allowsOtherFileTypes = false
        defer {
            panel.orderOut(nil)
            application.setActivationPolicy(previousPolicy)
        }
        application.activate()
        return panel.runModal() == .OK ? panel.url : nil
    }
}
