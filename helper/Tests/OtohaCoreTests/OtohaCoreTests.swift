import Foundation
import XCTest
@testable import OtohaCore

final class OtohaCoreTests: XCTestCase {
    func testHelperLaunchModeDefaultsToBackground() {
        XCTAssertEqual(
            HelperLaunchMode(arguments: ["otoha-helper", "--request-json", "{}"]),
            .background
        )
    }

    func testHelperLaunchModeUsesDebugUIOnlyWhenRequested() {
        XCTAssertEqual(
            HelperLaunchMode(arguments: ["otoha-helper", "--request-json", "{}", "--ui"]),
            .debugUI
        )
    }

    func testSubtitleLibraryUsesConfiguredPathAndFallsBackToMacApplicationSupport() throws {
        let home = URL(fileURLWithPath: "/Users/test", isDirectory: true)

        XCTAssertEqual(
            SubtitleLibrary.rootDirectory(configuredPath: nil, homeDirectory: home),
            home.appendingPathComponent("Library/Application Support/Otoha/Subtitles", isDirectory: true)
        )
        XCTAssertEqual(
            SubtitleLibrary.rootDirectory(configuredPath: "/Users/test/captions", homeDirectory: home),
            URL(fileURLWithPath: "/Users/test/captions", isDirectory: true)
        )
        XCTAssertEqual(
            SubtitleLibrary.rootDirectory(configuredPath: "~/Captions", homeDirectory: home),
            URL(fileURLWithPath: "/Users/test/Captions", isDirectory: true)
        )
    }

    func testSubtitleLibrarySeparatesVideosAndListsOnlyASSFiles() throws {
        let fixture = try Fixture()
        let mediaURL = URL(fileURLWithPath: "/Videos/episode.mkv")
        let otherMediaURL = URL(fileURLWithPath: "/Other/episode.mkv")
        let directory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: fixture.directory)
        let otherDirectory = SubtitleLibrary.mediaDirectory(for: otherMediaURL, rootDirectory: fixture.directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data().write(to: directory.appendingPathComponent("episode.ass"))
        try Data().write(to: directory.appendingPathComponent("episode (2).ass"))
        try Data().write(to: directory.appendingPathComponent("episode [ja-JP to zh-Hans].ass"))
        try Data().write(to: directory.appendingPathComponent("episode.srt"))
        try Data().write(to: directory.appendingPathComponent("partial.tmp"))

        let subtitles = try SubtitleLibrary.list(for: mediaURL, rootDirectory: fixture.directory)

        XCTAssertNotEqual(directory, otherDirectory)
        XCTAssertEqual(
            Set(subtitles.map(\.lastPathComponent)),
            ["episode.ass", "episode (2).ass", "episode [ja-JP to zh-Hans].ass"]
        )
        XCTAssertTrue(try SubtitleLibrary.list(for: otherMediaURL, rootDirectory: fixture.directory).isEmpty)
    }

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
        let event = HelperEvent.phase(.transcribing, jobId: "job-123", message: "Listening")
        let line = try event.jsonLine()
        let decoded = try JSONDecoder().decode(HelperEventPayload.self, from: Data(line.utf8))

        XCTAssertEqual(decoded.protocolVersion, 1)
        XCTAssertEqual(decoded.type, "phase")
        XCTAssertEqual(decoded.jobId, "job-123")
        XCTAssertEqual(decoded.phase, "transcribing")
        XCTAssertEqual(decoded.message, "Listening")
        XCTAssertFalse(line.contains("\n"))
    }

    func testHelperFailureCarriesStableErrorCode() throws {
        let event = HelperEvent.failure(code: .speechNoSpeech, jobId: "job-123", message: "没有识别到语音")
        let decoded = try JSONDecoder().decode(HelperEventPayload.self, from: Data(try event.jsonLine().utf8))

        XCTAssertEqual(decoded.type, "error")
        XCTAssertEqual(decoded.code?.rawValue, HelperErrorCode.speechNoSpeech.rawValue)
        XCTAssertEqual(decoded.jobId, "job-123")
    }

    func testASSWriterSortsCuesAndFormatsBilingualTextWithStyles() throws {
        let cues = [
            SubtitleCue(start: 1.2345, end: 2.0, source: "Hello", translation: "你好"),
            SubtitleCue(start: 0, end: 1.25, source: "First", translation: "第一句"),
        ]
        let ass = try ASSWriter.serialize(cues)

        XCTAssertTrue(ass.hasPrefix("[Script Info]\n"))
        XCTAssertTrue(ass.contains("Style: OtohaSource,Arial,28,&H80FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,24,1"))
        XCTAssertTrue(ass.contains("Style: OtohaTranslation,Arial,36,&H00FFFFFF,&H00FFFFFF,&H80000000,&H80000000,0,0,0,0,100,100,0,0,1,1.25,0,2,32,32,10,1"))
        XCTAssertTrue(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.25,OtohaSource,,0,0,0,,First"))
        XCTAssertTrue(ass.contains("Dialogue: 0,0:00:00.00,0:00:01.25,OtohaTranslation,,0,0,0,,第一句"))
        XCTAssertTrue(ass.contains("Dialogue: 0,0:00:01.23,0:00:02.00,OtohaSource,,0,0,0,,Hello"))
        XCTAssertTrue(ass.contains("Dialogue: 0,0:00:01.23,0:00:02.00,OtohaTranslation,,0,0,0,,你好"))
        let translationIndex = ass.range(of: "Dialogue: 0,0:00:00.00,0:00:01.25,OtohaTranslation")!.lowerBound
        let sourceIndex = ass.range(of: "Dialogue: 0,0:00:00.00,0:00:01.25,OtohaSource")!.lowerBound
        XCTAssertLessThan(translationIndex, sourceIndex)
    }

    func testASSWriterEscapesTextAndNormalizesLineBreaks() throws {
        let ass = try ASSWriter.serialize([
            SubtitleCue(start: 0, end: 1, source: "Hello {world}\nagain", translation: "你好\\there"),
        ])

        XCTAssertTrue(ass.contains("Hello \\{world\\}\\Nagain"))
        XCTAssertTrue(ass.contains("你好\\\\there"))
    }

    func testASSWriterScalesFontSizes() throws {
        let ass = try ASSWriter.serialize([
            SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好"),
        ], scale: 1.2)

        XCTAssertTrue(ass.contains("Style: OtohaSource,Arial,34,"))
        XCTAssertTrue(ass.contains("Style: OtohaTranslation,Arial,43,"))
    }

    func testTimedTranscriptCueBuilderUsesWordTimingAndSplitsPhrases() {
        let cues = TimedTranscriptCueBuilder.build(tokens: [
            TimedTranscriptToken(text: "Hello world. ", start: 0, end: 1.2),
            TimedTranscriptToken(text: "Second phrase", start: 1.4, end: 2.8),
        ], fallbackStart: 0, fallbackEnd: 3)

        XCTAssertEqual(cues, [
            TimedTranscriptCue(start: 0, end: 1.2, text: "Hello world."),
            TimedTranscriptCue(start: 1.4, end: 2.8, text: "Second phrase"),
        ])
    }

    func testTimedTranscriptCueBuilderSplitsUntimedTextAcrossFallbackRange() {
        let cues = TimedTranscriptCueBuilder.build(
            tokens: [TimedTranscriptToken(text: "第一句。第二句。")],
            fallbackStart: 2,
            fallbackEnd: 4
        )

        XCTAssertEqual(cues.map(\.text), ["第一句。", "第二句。"])
        XCTAssertEqual(cues.first?.start, 2)
        XCTAssertEqual(cues.last?.end, 4)
    }

    func testASSOutputChoosesNextNameWithoutOverwriting() throws {
        let fixture = try Fixture()
        let existing = fixture.directory.appendingPathComponent("Movie.ass")
        try Data("keep me".utf8).write(to: existing)
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        let output = try ASSOutput.publish([cue], baseName: "Movie", directory: fixture.directory)

        XCTAssertEqual(output.lastPathComponent, "Movie (2).ass")
        XCTAssertEqual(try String(contentsOf: existing, encoding: .utf8), "keep me")
        XCTAssertTrue(try String(contentsOf: output, encoding: .utf8).contains("Dialogue:"))
    }

    func testASSOutputReplacesExistingFileWhenRequested() throws {
        let fixture = try Fixture()
        let existing = fixture.directory.appendingPathComponent("Movie.ass")
        try Data("old subtitle".utf8).write(to: existing)
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        let output = try ASSOutput.publish(
            [cue],
            baseName: "Movie",
            directory: fixture.directory,
            overwriteExisting: true
        )

        XCTAssertEqual(output, existing)
        XCTAssertTrue(try String(contentsOf: existing, encoding: .utf8).contains("Dialogue:"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.directory.appendingPathComponent("Movie (2).ass").path))
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).contains(where: { $0.hasSuffix(".tmp") }))
    }

    func testASSOutputDoesNotCommitWhenCancelledAfterTemporaryWrite() throws {
        let fixture = try Fixture()
        var checks = 0
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        XCTAssertThrowsError(try ASSOutput.publish(
            [cue],
            baseName: "Movie",
            directory: fixture.directory,
            isCancelled: {
                checks += 1
                return checks > 1
            }
        )) { error in
            XCTAssertEqual(error as? ASSOutputError, .cancelled)
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("Movie.ass"))
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".tmp") }))
    }

    func testASSOutputRemovesPublishedFileWhenCancelledAfterFinalPrePublishCheck() throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        var checks = 0
        let cue = SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")

        XCTAssertThrowsError(try ASSOutput.publish(
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
            XCTAssertEqual(error as? ASSOutputError, .cancelled)
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains("Movie.ass"))
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".tmp") }))
    }

    func testASSWriterRejectsInvalidCueTimesAndEmptyText() {
        XCTAssertThrowsError(try ASSWriter.serialize([
            SubtitleCue(start: 2, end: 1, source: "bad", translation: "坏"),
        ]))
        XCTAssertThrowsError(try ASSWriter.serialize([
            SubtitleCue(start: 0, end: 1, source: "", translation: ""),
        ]))
        XCTAssertThrowsError(try ASSWriter.serialize([], scale: 1.5))
    }

    func testSubtitleJobPipelineUsesInjectedProvidersAndPublishesTimedBilingualASS() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let cues = [TranscribedCue(start: 0.5, end: 1.25, source: "こんにちは")]
        let existingURL = fixture.directory.appendingPathComponent("movie ; $ input [ja-JP to en-US].ass")
        try Data("old subtitle".utf8).write(to: existingURL)

        let outputURL = try await SubtitleJobPipeline.run(
            configuration: fixture.configuration(),
            cancellationFileURL: cancellationURL,
            prepareTranslation: {},
            transcribe: { TranscriptionOutput(cues: cues, sourceTimeOffset: 2) },
            translate: { _ in ["你好"] }
        )

        XCTAssertEqual(outputURL.lastPathComponent, "movie ; $ input [ja-JP to en-US].ass")
        XCTAssertEqual(outputURL, existingURL)
        let content = try String(contentsOf: outputURL, encoding: .utf8)
        XCTAssertTrue(content.contains("Dialogue: 0,0:00:02.50,0:00:03.25,OtohaSource,,0,0,0,,こんにちは"))
        XCTAssertTrue(content.contains("Dialogue: 0,0:00:02.50,0:00:03.25,OtohaTranslation,,0,0,0,,你好"))
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
        XCTAssertFalse(files.contains("movie ; $ input [ja-JP to en-US].ass"))
    }

    func testSubtitleJobRunnerHonorsCancellationBeforeStartingDependencies() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        try Data("cancel".utf8).write(to: cancellationURL)
        let runner = SubtitleJobRunner(dependencies: .init(
            prepareTranslation: { throw FixtureError.unexpectedDependencyCall },
            transcribe: { throw FixtureError.unexpectedDependencyCall },
            translate: { _ in throw FixtureError.unexpectedDependencyCall }
        ))

        do {
            _ = try await runner.run(
                configuration: fixture.configuration(),
                cancellation: JobCancellationToken(cancellationFileURL: cancellationURL)
            )
            XCTFail("Expected cancellation")
        } catch is CancellationError {
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".ass") }))
    }

    func testSubtitleJobRunnerCancelsBeforePublishingAfterTranscription() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let runner = SubtitleJobRunner(dependencies: .init(
            prepareTranslation: {},
            transcribe: {
                try Data("cancel".utf8).write(to: cancellationURL)
                return TranscriptionOutput(cues: [TranscribedCue(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
            },
            translate: { _ in ["你好"] }
        ))

        do {
            _ = try await runner.run(
                configuration: fixture.configuration(),
                cancellation: JobCancellationToken(cancellationFileURL: cancellationURL)
            )
            XCTFail("Expected cancellation")
        } catch is CancellationError {
        }

        let files = try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path)
        XCTAssertFalse(files.contains(where: { $0.hasSuffix(".ass") }))
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
        XCTAssertFalse(files.contains("movie ; $ input [ja-JP to en-US].ass"))
    }

    func testSubtitleJobPipelineKeepsExistingOutputWhenTranslationFails() async throws {
        let fixture = try Fixture()
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let outputURL = fixture.directory.appendingPathComponent("movie ; $ input [ja-JP to en-US].ass")
        try Data("keep old subtitle".utf8).write(to: outputURL)

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

        XCTAssertEqual(try String(contentsOf: outputURL, encoding: .utf8), "keep old subtitle")
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

enum FixtureError: Error {
    case translationFailed
    case unexpectedDependencyCall
}

struct Fixture {
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
        sourceLanguage: String = "ja-JP",
        outputDirectory: URL? = nil
    ) -> JobConfiguration {
        JobConfiguration(
            mediaURL: mediaURL,
            ffmpegPath: ffmpegPath,
            audioStreamIndex: audioStreamIndex,
            sourceLanguage: sourceLanguage,
            targetLanguage: "en-US",
            outputDirectory: outputDirectory ?? directory
        )
    }

    func writeExecutable(_ contents: String, to url: URL) throws {
        try Data(contents.utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }
}
