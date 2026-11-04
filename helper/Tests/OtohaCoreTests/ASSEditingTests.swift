import Foundation
import XCTest
@testable import OtohaCore

final class ASSEditingTests: XCTestCase {
    private let cues = [SubtitleCue(start: 1.25, end: 4.5, source: "Hello, 世界\nLiteral \\N {name}", translation: "こんにちは\n第二行")]

    func testTextRoundTripPreservesTimelineStylesAndExplicitNewlines() throws {
        let original = try ASSWriter.serialize(cues)
        let document = try ASSEditDocument(original)
        XCTAssertEqual(document.cues[0].source, cues[0].source)
        XCTAssertEqual(document.cues[0].translation, cues[0].translation)
        XCTAssertEqual(try document.replacingTexts(document.cues.map { .init(source: $0.source, translation: $0.translation) }), original)
        let updated = try document.replacingTexts([.init(source: "修正 English, 日本語\n第二行", translation: "Corrected \\N {text}\nNext")])
        let parsed = try ASSEditDocument(updated)
        XCTAssertEqual(parsed.cues[0].start, 1.25)
        XCTAssertEqual(parsed.cues[0].end, 4.5)
        XCTAssertEqual(parsed.cues[0].source, "修正 English, 日本語\n第二行")
        XCTAssertEqual(parsed.cues[0].translation, "Corrected \\N {text}\nNext")
        XCTAssertEqual(original.components(separatedBy: "[Events]")[0], updated.components(separatedBy: "[Events]")[0])
    }

    func testDuplicateTimestampsRemainSeparateAndMalformedPairsAreRejected() throws {
        let original = try ASSWriter.serialize([
            SubtitleCue(start: 0, end: 2, source: "One", translation: "一"),
            SubtitleCue(start: 0, end: 2, source: "Two", translation: "二"),
        ])
        XCTAssertEqual(try ASSEditDocument(original).cues.map(\.source), ["One", "Two"])
        XCTAssertThrowsError(try ASSEditDocument(original.replacingOccurrences(of: "OtohaSource,,0,0,0,,One", with: "Other,,0,0,0,,One")))
        XCTAssertThrowsError(try ASSEditDocument(original).replacingTexts([]))
        XCTAssertThrowsError(try ASSEditDocument(original).replacingTexts([.init(source: "", translation: "x"), .init(source: "y", translation: "z")]))
    }

    func testEditedLongMixedTextReusesCanvasAndStyleWrappingWithCRLF() throws {
        let original = try ASSWriter.serialize(cues, scale: 1.4, videoWidth: 1080, videoHeight: 1920)
            .replacingOccurrences(of: "\n", with: "\r\n")
        let longText = String(repeating: "自己编写的中文与日本語 English mixed text。", count: 12)
        let edited = try ASSEditDocument(original).replacingTexts([.init(source: longText, translation: longText)])
        let parsed = try ASSEditDocument(edited)
        XCTAssertGreaterThan(parsed.cues[0].source.components(separatedBy: "\n").count, 2)
        XCTAssertEqual(parsed.cues[0].source.replacingOccurrences(of: "\n", with: ""), longText)
        XCTAssertTrue(edited.contains("\r\n"))
        XCTAssertEqual(original.components(separatedBy: "[Events]")[0], edited.components(separatedBy: "[Events]")[0])
    }

    func testAtomicReplacementFailureKeepsOldFileAndCleansTemporaryFile() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let target = fixture.directory.appendingPathComponent("edited.ass")
        try Data("original".utf8).write(to: target)
        XCTAssertThrowsError(try ASSOutput.replace(Data("new".utf8), at: target, beforeCommit: { throw FixtureError.translationFailed }))
        XCTAssertEqual(try String(contentsOf: target, encoding: .utf8), "original")
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: fixture.directory.path).contains { $0.hasSuffix(".tmp") })
    }

    func testLibrarySaveChecksRevisionAndRejectsOutsideFiles() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent(SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "ja") + ".ass")
        try Data(ASSWriter.serialize(cues).utf8).write(to: path)
        let snapshot = try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        let texts = [ASSEditText(source: "Updated", translation: "修正")]
        let saved = try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: snapshot.revision, texts: texts)
        XCTAssertEqual(saved.cues[0].source, "Updated")
        XCTAssertNotEqual(saved.revision, snapshot.revision)
        XCTAssertThrowsError(try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: snapshot.revision, texts: texts))
        XCTAssertThrowsError(try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: fixture.mediaURL))
        let link = directory.appendingPathComponent("movie ; $ input [ja to en].ass")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.mediaURL)
        XCTAssertThrowsError(try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: link))
    }
}
