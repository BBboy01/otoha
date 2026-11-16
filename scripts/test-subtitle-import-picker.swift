import AppKit
import Foundation

@main
struct PickerContractTests {
    @MainActor static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        var output = Data()
        let cancelled = SubtitleImportPickerCLI.run(arguments: ["helper", "--choose-subtitle-json"],
            choose: { nil }, emit: { output = $0 })
        precondition(cancelled)
        let response = try JSONSerialization.jsonObject(with: output) as! [String: Any]
        precondition(response["path"] is NSNull, "Cancellation must explicitly return path:null")
        let subtitle = root.appendingPathComponent("self-authored.srt")
        try Data("1\n00:00:00,000 --> 00:00:01,000\nHello\n".utf8).write(to: subtitle)
        _ = SubtitleImportPickerCLI.run(arguments: ["helper", "--choose-subtitle-json"],
            choose: { subtitle }, emit: { output = $0 })
        let selected = try JSONSerialization.jsonObject(with: output) as! [String: Any]
        precondition(selected["path"] as? String == subtitle.path)
        try Data([0xFF, 0xFE, 0x00]).write(to: subtitle)
        _ = SubtitleImportPickerCLI.run(arguments: ["helper", "--choose-subtitle-json"],
            choose: { subtitle }, emit: { output = $0 })
        let invalid = try JSONSerialization.jsonObject(with: output) as! [String: Any]
        precondition(invalid["path"] is NSNull)
        precondition(invalid["message"] is String)
        var chose = false
        precondition(!SubtitleImportPickerCLI.run(arguments: ["helper"], choose: { chose = true; return nil }, emit: { _ in }))
        precondition(!chose)
        print("Subtitle import picker selection/cancellation contract passed.")
    }
}
