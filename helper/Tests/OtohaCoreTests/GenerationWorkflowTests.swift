import Foundation
import XCTest
@testable import OtohaCore

final class GenerationWorkflowTests: XCTestCase {
    func testCacheRejectsLinkedDirectory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let external = root.appendingPathComponent("External")
        try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let linked = root.appendingPathComponent("Cache")
        try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: external)
        let cache = TranscriptionCache(directory: linked)
        XCTAssertThrowsError(try cache.save(.init(cues: [.init(start: 0, end: 1, source: "Hi")], sourceTimeOffset: 0), key: String(repeating: "a", count: 64)))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: external.path).isEmpty)
    }

    func testCachePruningOnlyRemovesOwnedEntries() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TranscriptionCache(directory: directory)
        let output = TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
        try Data("preserve".utf8).write(to: directory.appendingPathComponent("notes.json"))
        for n in 1...102 { try cache.save(output, key: String(format: "%064x", n)) }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        XCTAssertEqual(files.filter { $0.lastPathComponent.count == 69 }.count, 100)
        XCTAssertTrue(FileManager.default.fileExists(atPath: directory.appendingPathComponent("notes.json").path))
    }

    func testFailedTranslationCanRetryWithoutTranscribingAgain() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = directory.appendingPathComponent("test.mp4")
        try Data("media".utf8).write(to: media)
        let config = JobConfiguration(mediaURL: media, ffmpegPath: "/usr/bin/true", audioStreamIndex: 0,
            sourceLanguage: "en", targetLanguage: "ja", outputDirectory: directory.appendingPathComponent("Subs"))
        let calls = Calls()
        let runner = SubtitleJobRunner(dependencies: .init(prepareTranslation: {}, transcribe: {
            await calls.increment()
            return TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
        }, translate: { _ in
            if await calls.failTranslationOnce() { throw ImportError.empty }
            return ["こんにちは"]
        }))
        let token = JobCancellationToken(cancellationFileURL: directory.appendingPathComponent("cancel"))
        do { _ = try await runner.run(configuration: config, cancellation: token); XCTFail("Expected translation failure") }
        catch ImportError.empty {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: config.outputDirectory.path))
        _ = try await runner.run(configuration: config, cancellation: token)
        let count = await calls.count
        XCTAssertEqual(count, 1)
    }

    func testImportedSRTJobSkipsTranscriptionAndPreservesTimes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = directory.appendingPathComponent("test.mp4")
        try Data("media".utf8).write(to: media)
        let srt = directory.appendingPathComponent("test.srt")
        try Data("1\n00:00:01,250 --> 00:00:01,270\nHello".utf8).write(to: srt)
        let config = JobConfiguration(mediaURL: media, ffmpegPath: "", audioStreamIndex: -1,
            sourceLanguage: "en", targetLanguage: "ja", outputDirectory: directory.appendingPathComponent("Subs"),
            generationMode: .translate, inputSubtitleURL: srt)
        let runner = SubtitleJobRunner(dependencies: .init(prepareTranslation: {}, transcribe: {
            XCTFail("Must not transcribe an imported subtitle"); throw ImportError.empty
        }, translate: { cues in
            XCTAssertEqual(cues.first?.start, 1.25)
            return ["こんにちは"]
        }))
        let path = try await runner.run(configuration: config,
            cancellation: JobCancellationToken(cancellationFileURL: directory.appendingPathComponent("cancel")))
        XCTAssertTrue(try String(contentsOf: path, encoding: .utf8).contains("0:00:01.25,0:00:01.27"))
        XCTAssertEqual(try String(contentsOf: srt, encoding: .utf8), "1\n00:00:01,250 --> 00:00:01,270\nHello")
    }

    func testSourceJobSkipsTranslationAndReusesPersistedTranscription() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = directory.appendingPathComponent("test.mp4")
        try Data("media".utf8).write(to: media)
        let config = JobConfiguration(mediaURL: media, ffmpegPath: "/usr/bin/true", audioStreamIndex: 0,
            sourceLanguage: "en", targetLanguage: "", outputDirectory: directory.appendingPathComponent("Subs"), generationMode: .source)
        let calls = Calls()
        let runner = SubtitleJobRunner(dependencies: .init(
            prepareTranslation: { XCTFail("Translation must not prepare") },
            transcribe: {
                await calls.increment()
                return TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
            }, translate: { _ in XCTFail("Translation must not run"); return [] }))
        let token = JobCancellationToken(cancellationFileURL: directory.appendingPathComponent("cancel"))
        let first = try await runner.run(configuration: config, cancellation: token)
        let second = try await runner.run(configuration: config, cancellation: token)
        let count = await calls.count
        XCTAssertEqual(count, 1)
        XCTAssertNotEqual(first, second)
        let ass = try String(contentsOf: first, encoding: .utf8)
        XCTAssertTrue(ass.contains("; OtohaMode: source"))
        XCTAssertFalse(ass.components(separatedBy: "\n").contains { $0.hasPrefix("Dialogue:") && $0.contains("OtohaTranslation") })
        let forced = JobConfiguration(mediaURL: media, ffmpegPath: "/usr/bin/true", audioStreamIndex: 0,
            sourceLanguage: "en", targetLanguage: "", outputDirectory: config.outputDirectory,
            generationMode: .source, forceTranscription: true)
        _ = try await runner.run(configuration: forced, cancellation: token)
        let forcedCount = await calls.count
        XCTAssertEqual(forcedCount, 2)
    }

    func testSRTImportPreservesTimingMultilineAndBOM() throws {
        let data = Data("\u{FEFF}1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\nworld\r\n\r\n".utf8)
        let cues = try SRTImporter.parse(data)
        XCTAssertEqual(cues, [TranscribedCue(start: 1.25, end: 3.5, source: "Hello\nworld")])
    }

    func testSRTImportRejectsMalformedAndEmptyIntervals() {
        for text in ["1\n00:00:03,000 --> 00:00:01,000\nHi", "1\n00:65:00,000 --> 00:66:00,000\nHi", "1\n00:00:01,000 --> 00:00:02,000\n", "bad"] {
            XCTAssertThrowsError(try SRTImporter.parse(Data(text.utf8)))
        }
    }

    func testSourceModeDoesNotRequireTranslationOrFFmpegForTranslateMode() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = directory.appendingPathComponent("test.mp4")
        try Data("media".utf8).write(to: media)
        let config = JobConfiguration(mediaURL: media, ffmpegPath: "/usr/bin/true", audioStreamIndex: 0,
            sourceLanguage: "en", targetLanguage: "", outputDirectory: directory, generationMode: .source)
        XCTAssertNoThrow(try config.validate())
        let srt = directory.appendingPathComponent("test.srt")
        try Data("1\n00:00:00,000 --> 00:00:01,000\nHello".utf8).write(to: srt)
        let imported = JobConfiguration(mediaURL: media, ffmpegPath: "", audioStreamIndex: -1,
            sourceLanguage: "en", targetLanguage: "ja", outputDirectory: directory,
            generationMode: .translate, inputSubtitleURL: srt)
        XCTAssertNoThrow(try imported.validate())
    }

    func testCacheInvalidatesMediaContentAndCorruption() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let media = directory.appendingPathComponent("test.mp4")
        try Data("media".utf8).write(to: media)
        let cache = TranscriptionCache(directory: directory.appendingPathComponent("Cache"))
        let key = try cache.key(mediaURL: media, audioStreamIndex: 2, sourceLanguage: "en")
        let output = TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0.5)
        try cache.save(output, key: key)
        XCTAssertEqual(cache.load(key: key)?.cues, output.cues)
        XCTAssertNil(cache.load(key: try cache.key(mediaURL: media, audioStreamIndex: 3, sourceLanguage: "en")))
        try Data("other".utf8).write(to: media)
        XCTAssertNil(cache.load(key: try cache.key(mediaURL: media, audioStreamIndex: 2, sourceLanguage: "en")))
        for file in try FileManager.default.contentsOfDirectory(at: cache.directory, includingPropertiesForKeys: nil) {
            try Data("broken".utf8).write(to: file)
        }
        XCTAssertNil(cache.load(key: key))
    }
}

private actor Calls {
    var count = 0
    var failed = false
    func increment() { count += 1 }
    func failTranslationOnce() -> Bool {
        if failed { return false }
        failed = true
        return true
    }
}
