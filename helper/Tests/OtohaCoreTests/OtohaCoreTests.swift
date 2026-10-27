import Foundation
import XCTest
@testable import OtohaCore

final class OtohaCoreTests: XCTestCase {
    func testJobConfigurationRejectsInvalidStreamAndLanguage() throws {
        let fixture = try Fixture()
        let invalidStream = fixture.configuration(audioStreamIndex: -1)
        XCTAssertThrowsError(try invalidStream.validate())

        let invalidLanguage = fixture.configuration(sourceLanguage: " ")
        XCTAssertThrowsError(try invalidLanguage.validate())
    }

    func testFFmpegLocatorUsesConfiguredPathOrSearchesPath() throws {
        let fixture = try Fixture()
        let executable = fixture.directory.appendingPathComponent("ffmpeg")
        try Data().write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        XCTAssertEqual(
            FFmpegLocator.resolve(configuredPath: executable.path)?.path,
            executable.path
        )
        XCTAssertEqual(
            FFmpegLocator.resolve(configuredPath: "", environment: ["PATH": fixture.directory.path])?.path,
            executable.path
        )
        XCTAssertNil(FFmpegLocator.resolve(configuredPath: "/missing/ffmpeg"))
    }

    func testFFmpegLocatorFindsSiblingFFprobe() throws {
        let fixture = try Fixture()
        let executable = fixture.directory.appendingPathComponent("ffprobe")
        try Data().write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

        XCTAssertEqual(
            FFmpegLocator.resolveProbe(beside: fixture.directory.appendingPathComponent("ffmpeg"))?.path,
            executable.path
        )
    }

    func testFFprobeUsesSelectedGlobalAudioIndexAndNormalizesStartTime() throws {
        let fixture = try Fixture()
        let ffmpeg = fixture.directory.appendingPathComponent("ffmpeg")
        let ffprobe = fixture.directory.appendingPathComponent("ffprobe")
        try fixture.writeExecutable("#!/bin/sh\nexit 0\n", to: ffmpeg)
        try fixture.writeExecutable(
            "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"index\":0,\"codec_type\":\"video\",\"start_time\":\"0.000000\"},{\"index\":1,\"codec_type\":\"audio\",\"start_time\":\"2.500000\"},{\"index\":2,\"codec_type\":\"audio\",\"start_time\":\"4.000000\"}],\"format\":{\"start_time\":\"0.500000\"}}'\n",
            to: ffprobe
        )

        let configuration = fixture.configuration(audioStreamIndex: 2)
        let startTime = try FFprobeReader.audioStreamStartTime(
            configuration: JobConfiguration(
                mediaURL: configuration.mediaURL,
                ffmpegPath: ffmpeg.path,
                audioStreamIndex: configuration.audioStreamIndex,
                sourceLanguage: configuration.sourceLanguage,
                targetLanguage: configuration.targetLanguage,
                outputDirectory: configuration.outputDirectory
            ),
            environment: ["PATH": fixture.directory.path]
        )

        XCTAssertEqual(startTime, 3.5, accuracy: 0.000_001)
        XCTAssertEqual(FFprobeReader.probeArguments(mediaPath: configuration.mediaURL.path), [
            "-v", "error", "-show_entries", "stream=index,codec_type,start_time:format=start_time", "-of", "json",
            configuration.mediaURL.path,
        ])
    }

    func testFFmpegArgumentsMapSelectedGlobalStreamWithoutShellParsing() throws {
        let fixture = try Fixture()
        let config = fixture.configuration(audioStreamIndex: 3)
        let arguments = FFmpegCommand.arguments(configuration: config, outputURL: fixture.audioURL)

        XCTAssertEqual(arguments, [
            "-nostdin", "-hide_banner", "-loglevel", "error",
            "-i", fixture.mediaURL.path,
            "-map", "0:3", "-vn", "-ac", "1", "-ar", "16000",
            "-c:a", "pcm_s16le", "-f", "wav", fixture.audioURL.path,
        ])
        XCTAssertTrue(arguments.contains(fixture.mediaURL.path))
    }

    func testFFmpegArgumentsUseSpeechAnalyzerAudioFormat() throws {
        let fixture = try Fixture()
        let config = fixture.configuration()
        let format = AudioFormatSpecification(sampleRate: 48_000, channelCount: 2, codec: "pcm_f32le")
        let arguments = FFmpegCommand.arguments(configuration: config, outputURL: fixture.audioURL, audioFormat: format)

        XCTAssertTrue(arguments.indices.contains { index in
            Array(arguments[index...].prefix(6)) == ["-ac", "2", "-ar", "48000", "-c:a", "pcm_f32le"]
        })
    }

    func testHelperEventEncodesAsSingleJSONLine() throws {
        let event = HelperEvent.phase(.transcribing, message: "Listening")
        let line = try event.jsonLine()
        let decoded = try JSONDecoder().decode(HelperEventPayload.self, from: Data(line.utf8))

        XCTAssertEqual(decoded.type, "phase")
        XCTAssertEqual(decoded.phase, "transcribing")
        XCTAssertEqual(decoded.message, "Listening")
        XCTAssertFalse(line.contains("\n"))
    }

    func testSRTWriterSortsCuesAndFormatsBilingualText() throws {
        let cues = [
            SubtitleCue(start: 1.2345, end: 2.0, source: "Hello", translation: "你好"),
            SubtitleCue(start: 0, end: 1.25, source: "First", translation: "第一句"),
        ]
        let srt = try SRTWriter.serialize(cues)

        XCTAssertEqual(srt, """
        1
        00:00:00,000 --> 00:00:01,250
        First
        第一句

        2
        00:00:01,235 --> 00:00:02,000
        Hello
        你好

        """)
    }

    func testSRTOutputChoosesNextNameWithoutOverwriting() throws {
        let fixture = try Fixture()
        let existing = fixture.directory.appendingPathComponent("Movie.srt")
        try Data("keep me".utf8).write(to: existing)
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        let output = try SRTOutput.publish([cue], baseName: "Movie", directory: fixture.directory)

        XCTAssertEqual(output.lastPathComponent, "Movie (2).srt")
        XCTAssertEqual(try String(contentsOf: existing, encoding: .utf8), "keep me")
        XCTAssertTrue(try String(contentsOf: output, encoding: .utf8).contains("Hello\n你好"))
    }

    func testSRTOutputDoesNotCommitWhenCancelledAfterTemporaryWrite() throws {
        let fixture = try Fixture()
        var checks = 0
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        XCTAssertThrowsError(try SRTOutput.publish(
            [cue],
            baseName: "Movie",
            directory: fixture.directory,
            isCancelled: {
                checks += 1
                return checks > 1
            }
        )) { error in
            XCTAssertEqual(error as? SRTOutputError, .cancelled)
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("Movie.srt"))
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".tmp") }))
    }

    func testSRTOutputRemovesPublishedFileWhenCancelledAfterFinalPrePublishCheck() throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        var checks = 0
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        XCTAssertThrowsError(try SRTOutput.publish(
            [cue],
            baseName: "Movie",
            directory: fixture.directory,
            isCancelled: {
                checks += 1
                let wasCancelled = FileManager.default.fileExists(atPath: cancellationURL.path)
                if checks == 2 {
                    do {
                        try Data("cancel".utf8).write(to: cancellationURL)
                    } catch {
                        XCTFail("Could not create cancellation marker: \(error)")
                    }
                }
                return wasCancelled
            }
        )) { error in
            XCTAssertEqual(error as? SRTOutputError, .cancelled)
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("Movie.srt"))
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".tmp") }))
    }

    func testSRTWriterRejectsInvalidCueTimesAndEmptyText() {
        XCTAssertThrowsError(try SRTWriter.serialize([
            SubtitleCue(start: 2, end: 1, source: "bad", translation: "坏"),
        ]))
        XCTAssertThrowsError(try SRTWriter.serialize([
            SubtitleCue(start: 0, end: 1, source: "", translation: ""),
        ]))
    }

    func testSubtitleJobPipelineUsesInjectedProvidersAndPublishesTimedBilingualSRT() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let cues = [TranscribedCue(start: 0.5, end: 1.25, source: "こんにちは")]

        let outputURL = try await SubtitleJobPipeline.run(
            configuration: fixture.configuration(),
            cancellationFileURL: cancellationURL,
            prepareTranslation: {},
            transcribe: { TranscriptionOutput(cues: cues, sourceTimeOffset: 2) },
            translate: { _ in ["你好"] }
        )

        XCTAssertEqual(outputURL.lastPathComponent, "movie ; $ input.srt")
        XCTAssertEqual(try String(contentsOf: outputURL, encoding: .utf8), """
        1
        00:00:02,500 --> 00:00:03,250
        こんにちは
        你好

        """)
    }

    func testSubtitleJobPipelineStopsBeforeTranslationWhenCancelledAfterTranscription() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let cues = [TranscribedCue(start: 0, end: 1, source: "Hello")]

        do {
            _ = try await SubtitleJobPipeline.run(
                configuration: fixture.configuration(),
                cancellationFileURL: cancellationURL,
                prepareTranslation: {},
                transcribe: {
                    try Data().write(to: cancellationURL)
                    return TranscriptionOutput(cues: cues, sourceTimeOffset: 0)
                },
                translate: { _ in ["你好"] }
            )
            XCTFail("Expected cancellation")
        } catch is CancellationError {
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("movie ; $ input.srt"))
    }

    func testSubtitleJobPipelineDoesNotPublishWhenTranslationProviderFails() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")

        do {
            _ = try await SubtitleJobPipeline.run(
                configuration: fixture.configuration(),
                cancellationFileURL: cancellationURL,
                prepareTranslation: {},
                transcribe: { TranscriptionOutput(cues: [TranscribedCue(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0) },
                translate: { _ in throw FixtureError.translationFailed }
            )
            XCTFail("Expected translation failure")
        } catch FixtureError.translationFailed {
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("movie ; $ input.srt"))
    }

    func testTranslationAccumulatorMapsOutOfOrderResponsesAndRejectsWrongBatch() throws {
        var accumulator = try TranslationAccumulator(count: 3)
        try accumulator.record(clientIdentifier: "2", targetText: "三", batchRange: 0..<3)
        try accumulator.record(clientIdentifier: "0", targetText: "一", batchRange: 0..<3)
        try accumulator.record(clientIdentifier: "1", targetText: "二", batchRange: 0..<3)

        XCTAssertEqual(try accumulator.finish(), ["一", "二", "三"])

        XCTAssertThrowsError(try accumulator.record(clientIdentifier: "0", targetText: "bad", batchRange: 1..<3)) {
            XCTAssertEqual($0 as? TranslationAccumulatorError, .invalidResponse)
        }
    }
}

private enum FixtureError: Error {
    case translationFailed
}

private struct Fixture {
    let directory: URL
    let mediaURL: URL
    let audioURL: URL
    let ffmpegPath = "/bin/echo"

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("otoha-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        mediaURL = directory.appendingPathComponent("movie ; $ input.mkv")
        audioURL = directory.appendingPathComponent("audio.wav")
        try Data().write(to: mediaURL)
    }

    func configuration(
        audioStreamIndex: Int = 0,
        sourceLanguage: String = "ja-JP"
    ) -> JobConfiguration {
        JobConfiguration(
            mediaURL: mediaURL,
            ffmpegPath: ffmpegPath,
            audioStreamIndex: audioStreamIndex,
            sourceLanguage: sourceLanguage,
            targetLanguage: "en-US",
            outputDirectory: directory
        )
    }

    func writeExecutable(_ contents: String, to url: URL) throws {
        try Data(contents.utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }
}
