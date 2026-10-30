import AppKit
import Foundation
import SwiftUI
import Translation
import OtohaCore

@main
@MainActor
struct OtohaHelperApp: App {
    @NSApplicationDelegateAdaptor(HelperAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
private final class HelperAppDelegate: NSObject, NSApplicationDelegate {
    private var windowController: HelperWindowController?
    private var backgroundTask: Task<Void, Never>?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if ProcessInfo.processInfo.environment["OTOHA_DEBUG_BUNDLE"] == "1" {
            let bundleID = Bundle.main.bundleIdentifier ?? "<missing>"
            FileHandle.standardError.write(Data("Otoha bundle identifier: \(bundleID)\n".utf8))
        }
        let launchMode = HelperLaunchMode(arguments: CommandLine.arguments)
        NSApp.setActivationPolicy(launchMode == .debugUI ? .accessory : .prohibited)
        if let index = CommandLine.arguments.firstIndex(of: "--list-subtitles-json"),
           CommandLine.arguments.indices.contains(index + 1) {
            Self.listSubtitles(json: CommandLine.arguments[index + 1])
            NSApp.terminate(nil)
            return
        }

        let parsed = Self.parseRequest()
        let model = HelperModel(request: parsed.request, startupError: parsed.error, jobId: parsed.jobId)
        switch launchMode {
        case .debugUI:
            windowController = HelperWindowController(model: model)
        case .background:
            startBackgroundTask(model: model)
        }
    }

    private func startBackgroundTask(model: HelperModel) {
        backgroundTask = Task { @MainActor [model] in
            guard model.request != nil else {
                model.reportStartupError()
                return
            }
            guard #available(macOS 26.4, *) else {
                model.reportUnsupportedSystemVersion()
                return
            }
            guard let source = model.sourceLanguage, let target = model.targetLanguage else {
                model.reportStartupError()
                return
            }
            let session = TranslationSession(
                installedSource: source,
                target: target,
                preferredStrategy: .highFidelity
            )
            await model.run(using: session)
        }
    }

    private static func parseRequest() -> (request: HelperRequest?, error: String?, jobId: String?) {
        guard let index = CommandLine.arguments.firstIndex(of: "--request-json"),
              CommandLine.arguments.indices.contains(index + 1) else {
            return (nil, "缺少任务配置，无法启动 Otoha。", nil)
        }
        let rawJSON = CommandLine.arguments[index + 1]
        let rawJobId = (try? JSONSerialization.jsonObject(with: Data(rawJSON.utf8))) as? [String: Any]
        let jobId = rawJobId?["jobId"] as? String
        do {
            let request = try JSONDecoder().decode(HelperRequest.self, from: Data(rawJSON.utf8))
            return (request, nil, request.jobId)
        } catch {
            return (nil, "任务配置无效：\(error.localizedDescription)", jobId)
        }
    }

    private static func listSubtitles(json: String) {
        do {
            let request = try JSONDecoder().decode(SubtitleListingRequest.self, from: Data(json.utf8))
            let files = try SubtitleLibrary.list(
                for: request.mediaURL,
                rootDirectory: request.rootDirectory
            )
                .map { SubtitleListingResponse.Entry(path: $0.path) }
            let response = SubtitleListingResponse(rootDirectoryPath: request.rootDirectory.path, files: files)
            var data = try JSONEncoder().encode(response)
            data.append(0x0A)
            FileHandle.standardOutput.write(data)
        } catch {
            FileHandle.standardError.write(Data("字幕库读取失败：\(error.localizedDescription)\n".utf8))
            exit(EXIT_FAILURE)
        }
    }
}

@MainActor
private final class HelperWindowController: NSObject {
    private let model: HelperModel
    private let window: NSWindow

    init(model: HelperModel) {
        self.model = model
        let hostingController = NSHostingController(
            rootView: OtohaHelperView(model: model)
                .frame(width: 380, height: 132)
        )
        window = NSWindow(contentViewController: hostingController)
        window.title = "Otoha"
        window.styleMask = [.titled, .closable, .miniaturizable]
        window.setContentSize(NSSize(width: 380, height: 132))
        window.center()
        window.isReleasedWhenClosed = false
        super.init()

        NSApp.setActivationPolicy(.accessory)
        window.orderFrontRegardless()
    }
}

@MainActor
private struct OtohaHelperView: View {
    @ObservedObject var model: HelperModel

    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: model.cancelled ? "xmark.circle" : model.finished ? "checkmark.circle" : "waveform")
                    .foregroundStyle(model.cancelled ? Color.secondary : model.finished ? Color.green : Color.accentColor)
                    .accessibilityHidden(true)
                Text(model.finished ? "双语字幕已生成" : model.cancelled ? "任务已取消" : "Otoha 字幕转录")
                    .font(.headline)
            }
            Text(model.startupError ?? model.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let progress = model.progress, !model.finished, !model.cancelled {
                ProgressView(value: progress)
            } else if !model.finished && !model.cancelled && model.startupError == nil {
                ProgressView()
                    .controlSize(.small)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            if model.request == nil {
                content
            } else if #available(macOS 26.4, *) {
                content.translationTask(
                    source: model.sourceLanguage,
                    target: model.targetLanguage,
                    preferredStrategy: .highFidelity
                ) { session in
                    await model.run(using: session)
                }
            } else {
                content.task { model.reportUnsupportedSystemVersion() }
            }
        }
        .task { model.reportStartupError() }
    }
}
