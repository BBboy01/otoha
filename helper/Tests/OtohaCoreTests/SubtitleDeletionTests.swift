import Foundation
import XCTest
@testable import OtohaCore

final class SubtitleDeletionTests: XCTestCase {
    func testDeleteOnlySelectedLanguageAndKeepMediaAndOtherSubtitles() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("custom library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let selected = directory.appendingPathComponent(SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "ja") + ".ass")
        let other = directory.appendingPathComponent(SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "zh-Hans") + ".ass")
        try Data("self-authored selected".utf8).write(to: selected)
        try Data("self-authored other".utf8).write(to: other)
        try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: selected)
        XCTAssertFalse(FileManager.default.fileExists(atPath: selected.path))
        XCTAssertEqual(try String(contentsOf: other, encoding: .utf8), "self-authored other")
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.mediaURL.path))
        XCTAssertThrowsError(try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: selected))
    }

    func testRejectOutsidePathsDirectoriesAndSymbolicLinks() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let name = SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "ja") + ".ass"
        let link = directory.appendingPathComponent(name)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.mediaURL)
        for target in [fixture.mediaURL, directory, link] {
            XCTAssertThrowsError(try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: target))
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: fixture.mediaURL.path))
        try FileManager.default.removeItem(at: link)
        try FileManager.default.createDirectory(at: link, withIntermediateDirectories: false)
        XCTAssertThrowsError(try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: link))
        XCTAssertTrue(FileManager.default.fileExists(atPath: link.path))
    }

    func testDeletingSubtitleRemovesItsDraftAndHistory() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent(SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "ja") + ".ass")
        try Data(ASSWriter.serialize([.init(start: 0, end: 1, source: "before", translation: "前")]).utf8).write(to: path)
        let snapshot = try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        let saved = try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path,
            revision: snapshot.revision, cues: snapshot.cues)
        try ASSEditStore.persistDraft(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path,
            draft: .init(revision: saved.revision, cues: saved.cues, index: 0, scrollTop: 0))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).count, 2)
        try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }

    func testSuccessfulDeletionStillSucceedsWhenStateCleanupIsRejected() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent(SubtitleFilename.generatedBaseName(for: fixture.mediaURL, sourceLanguage: "en", targetLanguage: "ja") + ".ass")
        try Data(ASSWriter.serialize([.init(start: 0, end: 1, source: "before", translation: "前")]).utf8).write(to: path)
        let snapshot = try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        try ASSEditStore.persistDraft(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path,
            draft: .init(revision: snapshot.revision, cues: snapshot.cues, index: 0, scrollTop: 0))
        let state = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .first(where: { $0.lastPathComponent.hasPrefix(".otoha-history-") }))
        try FileManager.default.removeItem(at: state)
        let outside = fixture.directory.appendingPathComponent("unrelated")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("keep".utf8).write(to: outside.appendingPathComponent("keep.txt"))
        try FileManager.default.createSymbolicLink(at: state, withDestinationURL: outside)
        XCTAssertNoThrow(try SubtitleDeletion.remove(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: path.path))
        XCTAssertEqual(try String(contentsOf: outside.appendingPathComponent("keep.txt"), encoding: .utf8), "keep")
    }
}
