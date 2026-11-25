import Foundation
import XCTest
@testable import OtohaCore

final class TranscriptionCacheFailureTests: XCTestCase {
    func testCacheWriteFailureDoesNotDiscardCompletedTranscription() async throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("not a directory".utf8).write(to: root.appendingPathComponent(".TranscriptionCache"))
        let result = try await runner().run(configuration: configuration(root), cancellation: token(root))
        XCTAssertTrue(try String(contentsOf: result, encoding: .utf8).contains("Hello"))
        XCTAssertEqual(try String(contentsOf: root.appendingPathComponent(".TranscriptionCache"), encoding: .utf8), "not a directory")
    }

    func testUnsafeCachePathStillRejectsGeneration() async throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let external = root.appendingPathComponent("External")
        try FileManager.default.createDirectory(at: external, withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(".TranscriptionCache"), withDestinationURL: external)
        do {
            _ = try await runner().run(configuration: configuration(root), cancellation: token(root))
            XCTFail("Unsafe cache paths must fail closed")
        } catch ImportError.outsideLibrary {}
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: external.path).isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: configuration(root).outputDirectory.path))
    }

    func testCacheLinkToFileStillRejectsGeneration() async throws {
        try await rejectCacheLink(createTarget: true)
    }

    func testDanglingCacheLinkStillRejectsGeneration() async throws {
        try await rejectCacheLink(createTarget: false)
    }

    private func rejectCacheLink(createTarget: Bool) async throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let target = root.appendingPathComponent("target")
        if createTarget { try Data("preserve".utf8).write(to: target) }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent(".TranscriptionCache"), withDestinationURL: target)
        do {
            _ = try await runner().run(configuration: configuration(root), cancellation: token(root))
            XCTFail("All cache symlinks must fail closed")
        } catch ImportError.outsideLibrary {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: configuration(root).outputDirectory.path))
        if createTarget { XCTAssertEqual(try String(contentsOf: target, encoding: .utf8), "preserve") }
        else { XCTAssertFalse(FileManager.default.fileExists(atPath: target.path)) }
    }

    func testCancellationStillPreventsPublishingWhenCacheIsUnavailable() async throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        try Data().write(to: root.appendingPathComponent(".TranscriptionCache"))
        let cancellation = token(root)
        let runner = SubtitleJobRunner(dependencies: .init(prepareTranslation: {}, transcribe: {
            try Data().write(to: root.appendingPathComponent("cancel"))
            return TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
        }, translate: { _ in XCTFail("Cancelled work must not translate"); return [] }))
        do {
            _ = try await runner.run(configuration: configuration(root), cancellation: cancellation)
            XCTFail("Cancelled work must not publish")
        } catch is CancellationError {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: configuration(root).outputDirectory.path))
    }

    private func fixture() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("media".utf8).write(to: root.appendingPathComponent("video.mp4"))
        return root
    }

    private func configuration(_ root: URL) -> JobConfiguration {
        JobConfiguration(mediaURL: root.appendingPathComponent("video.mp4"), ffmpegPath: "/usr/bin/true",
            audioStreamIndex: 0, sourceLanguage: "en", targetLanguage: "ja", outputDirectory: root.appendingPathComponent("Subs"))
    }

    private func token(_ root: URL) -> JobCancellationToken {
        JobCancellationToken(cancellationFileURL: root.appendingPathComponent("cancel"))
    }

    private func runner() -> SubtitleJobRunner {
        SubtitleJobRunner(dependencies: .init(prepareTranslation: {}, transcribe: {
            TranscriptionOutput(cues: [.init(start: 0, end: 1, source: "Hello")], sourceTimeOffset: 0)
        }, translate: { _ in ["Translated"] }))
    }
}
