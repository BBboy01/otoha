import Foundation
import Darwin

public struct AudioFormatSpecification: Sendable, Equatable {
    public let sampleRate: Int
    public let channelCount: Int
    public let codec: String

    public init(sampleRate: Int, channelCount: Int, codec: String) {
        self.sampleRate = sampleRate
        self.channelCount = channelCount
        self.codec = codec
    }

    public static let speechDefault = AudioFormatSpecification(sampleRate: 16_000, channelCount: 1, codec: "pcm_s16le")
}

public enum FFmpegCommand {
    public static func arguments(
        configuration: JobConfiguration,
        outputURL: URL,
        audioFormat: AudioFormatSpecification = .speechDefault
    ) -> [String] {
        [
            "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", configuration.mediaURL.path,
            "-map", "0:\(configuration.audioStreamIndex)",
            "-vn", "-ac", String(audioFormat.channelCount), "-ar", String(audioFormat.sampleRate),
            "-c:a", audioFormat.codec, "-f", "wav", outputURL.path,
        ]
    }
}

public enum FFmpegExtractionError: Error, Equatable, LocalizedError {
    case cancelled
    case launchFailed(String)
    case exited(Int32)
    case emptyOutput

    public var errorDescription: String? {
        switch self {
        case .cancelled: "音轨提取已取消。"
        case let .launchFailed(reason): "FFmpeg 无法启动：\(reason)"
        case let .exited(code): "FFmpeg 退出状态为 \(code)，请检查视频和所选音轨。"
        case .emptyOutput: "FFmpeg 没有为所选音轨生成音频。"
        }
    }
}

public enum FFprobeReader {
    private struct ProbeResult: Decodable {
        let streams: [Stream]
        let format: Format?
    }

    private struct Stream: Decodable {
        let index: Int
        let codec_type: String
        let start_time: String?
    }

    private struct Format: Decodable {
        let start_time: String?
    }

    public static func audioStreamStartTime(
        configuration: JobConfiguration,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) throws -> Double {
        guard let ffmpegURL = FFmpegLocator.resolve(configuredPath: configuration.ffmpegPath, environment: environment),
              let ffprobeURL = FFmpegLocator.resolveProbe(beside: ffmpegURL, environment: environment) else {
            throw FFprobeError.notFound
        }
        let process = Process()
        let output = Pipe()
        process.executableURL = ffprobeURL
        process.arguments = probeArguments(mediaPath: configuration.mediaURL.path)
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw FFprobeError.failed(error.localizedDescription)
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw FFprobeError.failed("ffprobe exited with status \(process.terminationStatus).")
        }
        return try parseStartTime(data, configuration: configuration)
    }

    public static func audioStreamStartTime(
        configuration: JobConfiguration,
        cancellationFileURL: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        timeout: Duration = .seconds(30)
    ) async throws -> Double {
        guard let ffmpegURL = FFmpegLocator.resolve(configuredPath: configuration.ffmpegPath, environment: environment),
              let ffprobeURL = FFmpegLocator.resolveProbe(beside: ffmpegURL, environment: environment) else {
            throw FFprobeError.notFound
        }
        let process = Process()
        let output = Pipe()
        process.executableURL = ffprobeURL
        process.arguments = probeArguments(mediaPath: configuration.mediaURL.path)
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        try Task.checkCancellation()
        if FileManager.default.fileExists(atPath: cancellationFileURL.path) {
            throw CancellationError()
        }
        do {
            try process.run()
        } catch {
            throw FFprobeError.failed(error.localizedDescription)
        }

        do {
            let deadline = ContinuousClock.now.advanced(by: timeout)
            while process.isRunning {
                if Task.isCancelled || FileManager.default.fileExists(atPath: cancellationFileURL.path) {
                    terminate(process)
                    throw CancellationError()
                }
                if ContinuousClock.now >= deadline {
                    terminate(process)
                    throw FFprobeError.timedOut
                }
                try await Task.sleep(for: .milliseconds(50))
            }
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                throw FFprobeError.failed("ffprobe exited with status \(process.terminationStatus).")
            }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return try parseStartTime(data, configuration: configuration)
        } catch {
            if process.isRunning { terminate(process) }
            throw error
        }
    }

    static func probeArguments(mediaPath: String) -> [String] {
        [
            "-v", "error", "-show_entries", "stream=index,codec_type,start_time:format=start_time", "-of", "json",
            mediaPath,
        ]
    }

    private static func parseTime(_ value: String?) throws -> Double {
        guard let value, value != "N/A" else { return 0 }
        guard let seconds = Double(value), seconds.isFinite else { throw FFprobeError.invalidStartTime }
        return seconds
    }

    private static func parseStartTime(_ data: Data, configuration: JobConfiguration) throws -> Double {
        let result = try JSONDecoder().decode(ProbeResult.self, from: data)
        guard let stream = result.streams.first(where: { $0.index == configuration.audioStreamIndex && $0.codec_type == "audio" }) else {
            throw JobConfigurationError.invalidAudioStream
        }
        let streamStart = try parseTime(stream.start_time)
        let formatStart = try parseTime(result.format?.start_time)
        return streamStart - formatStart
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else {
            process.waitUntilExit()
            return
        }
        process.terminate()
        let deadline = Date().addingTimeInterval(0.2)
        while process.isRunning && Date() < deadline { usleep(10_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
    }
}

public enum FFprobeError: Error, Equatable, LocalizedError {
    case notFound
    case failed(String)
    case invalidStartTime
    case timedOut

    public var errorDescription: String? {
        switch self {
        case .notFound: "找不到 FFprobe，请将它放在 FFmpeg 旁边，或检查 FFmpeg 路径。"
        case let .failed(reason): "FFprobe 无法检查所选音轨：\(reason)"
        case .invalidStartTime: "FFprobe 返回了无效的音频流起始时间。"
        case .timedOut: "FFprobe 检查音轨超时。"
        }
    }
}

public enum FFmpegExtractor {
    public static func extract(
        configuration: JobConfiguration,
        outputURL: URL,
        cancellationFileURL: URL,
        audioFormat: AudioFormatSpecification = .speechDefault,
        emit: @Sendable (HelperEvent) -> Void = { _ in }
    ) async throws -> Double {
        try configuration.validate()
        guard let ffmpegURL = FFmpegLocator.resolve(configuredPath: configuration.ffmpegPath) else {
            throw JobConfigurationError.ffmpegNotExecutable
        }
        if FileManager.default.fileExists(atPath: cancellationFileURL.path) { throw FFmpegExtractionError.cancelled }
        let sourceTimeOffset = try await FFprobeReader.audioStreamStartTime(
            configuration: configuration,
            cancellationFileURL: cancellationFileURL
        )

        let process = Process()
        process.executableURL = ffmpegURL
        process.arguments = FFmpegCommand.arguments(configuration: configuration, outputURL: outputURL, audioFormat: audioFormat)
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            throw FFmpegExtractionError.launchFailed(error.localizedDescription)
        }
        emit(.phase(.extractingAudio, message: "正在提取所选音轨"))

        while process.isRunning {
            if Task.isCancelled || FileManager.default.fileExists(atPath: cancellationFileURL.path) {
                terminate(process)
                throw FFmpegExtractionError.cancelled
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            if Task.isCancelled || FileManager.default.fileExists(atPath: cancellationFileURL.path) {
                throw FFmpegExtractionError.cancelled
            }
            throw FFmpegExtractionError.exited(process.terminationStatus)
        }
        let attributes = try? FileManager.default.attributesOfItem(atPath: outputURL.path)
        guard (attributes?[.size] as? NSNumber)?.intValue ?? 0 > 44 else {
            throw FFmpegExtractionError.emptyOutput
        }
        return sourceTimeOffset
    }

    private static func terminate(_ process: Process) {
        guard process.isRunning else {
            process.waitUntilExit()
            return
        }
        process.terminate()
        let deadline = Date().addingTimeInterval(0.2)
        while process.isRunning && Date() < deadline { usleep(10_000) }
        if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        process.waitUntilExit()
    }
}
