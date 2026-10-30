import Foundation
import XCTest
@testable import OtohaCore

final class SubtitleCoreRegressionTests: XCTestCase {
    func testSubtitleLibraryUsesCanonicalMediaNameWhenListingGeneratedFiles() throws {
        let fixture = try Fixture()
        let mediaURL = URL(fileURLWithPath: "/Videos/movie:part .mkv")
        let directory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: fixture.directory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let generatedName = SubtitleFilename.generatedBaseName(
            for: mediaURL,
            sourceLanguage: "ja-JP",
            targetLanguage: "zh-Hans"
        ) + ".ass"
        try Data().write(to: directory.appendingPathComponent(generatedName))

        let subtitles = try SubtitleLibrary.list(for: mediaURL, rootDirectory: fixture.directory)

        XCTAssertEqual(subtitles.map(\.lastPathComponent), [generatedName])
        XCTAssertEqual(SubtitleFilename.mediaBaseName(for: mediaURL), "movie_part")
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

    func testFFprobeCanBeCancelledWhileProcessIsRunning() async throws {
        let fixture = try Fixture()
        let ffmpeg = fixture.directory.appendingPathComponent("ffmpeg")
        let ffprobe = fixture.directory.appendingPathComponent("ffprobe")
        try fixture.writeExecutable("#!/bin/sh\nexit 0\n", to: ffmpeg)
        try fixture.writeExecutable(
            "#!/bin/sh\nsleep 2\nprintf '%s' '{\"streams\":[{\"index\":0,\"codec_type\":\"audio\",\"start_time\":\"0\"}],\"format\":{\"start_time\":\"0\"}}'\n",
            to: ffprobe
        )
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let task = Task {
            try await FFprobeReader.audioStreamStartTime(
                configuration: fixture.configuration(),
                cancellationFileURL: cancellationURL,
                environment: ["PATH": fixture.directory.path],
                timeout: .seconds(5)
            )
        }

        try await Task.sleep(for: .milliseconds(100))
        try Data("cancel".utf8).write(to: cancellationURL)
        do {
            _ = try await task.value
            XCTFail("Expected ffprobe cancellation")
        } catch is CancellationError {
        }
    }

    func testFFprobeTimesOutAndTerminatesProcess() async throws {
        let fixture = try Fixture()
        let ffmpeg = fixture.directory.appendingPathComponent("ffmpeg")
        let ffprobe = fixture.directory.appendingPathComponent("ffprobe")
        try fixture.writeExecutable("#!/bin/sh\nexit 0\n", to: ffmpeg)
        try fixture.writeExecutable("#!/bin/sh\nsleep 2\n", to: ffprobe)

        do {
            _ = try await FFprobeReader.audioStreamStartTime(
                configuration: fixture.configuration(),
                cancellationFileURL: fixture.directory.appendingPathComponent("cancel"),
                environment: ["PATH": fixture.directory.path],
                timeout: .milliseconds(100)
            )
            XCTFail("Expected ffprobe timeout")
        } catch let error as FFprobeError {
            XCTAssertEqual(error, .timedOut)
        }
    }

    func testInvalidConfigurationDoesNotCreateOutputDirectory() async throws {
        let fixture = try Fixture()
        let missingDirectory = fixture.directory.appendingPathComponent("new-output")
        let runner = SubtitleJobRunner(dependencies: .init(
            prepareTranslation: { throw FixtureError.unexpectedDependencyCall },
            transcribe: { throw FixtureError.unexpectedDependencyCall },
            translate: { _ in throw FixtureError.unexpectedDependencyCall }
        ))

        do {
            _ = try await runner.run(
                configuration: fixture.configuration(sourceLanguage: " ", outputDirectory: missingDirectory),
                cancellation: JobCancellationToken()
            )
            XCTFail("Expected invalid configuration")
        } catch JobConfigurationError.invalidLanguages {
        }

        XCTAssertFalse(FileManager.default.fileExists(atPath: missingDirectory.path))
    }
}
