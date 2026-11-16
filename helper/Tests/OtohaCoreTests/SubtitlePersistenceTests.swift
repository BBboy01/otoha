import Foundation
import XCTest
@testable import OtohaCore

final class SubtitlePersistenceTests: XCTestCase {
    func testDraftSurvivesReadAndSaveCreatesRestorableBackup() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let directory = SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let path = directory.appendingPathComponent("\(SubtitleFilename.mediaBaseName(for: fixture.mediaURL)) [en to ja].ass")
        try Data(ASSWriter.serialize([.init(start: 1, end: 2, source: "before", translation: "前")]).utf8).write(to: path)
        let original = try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        try ASSEditStore.persistDraft(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path,
            draft: .init(revision: original.revision, cues: original.cues, index: 0, scrollTop: 12))
        XCTAssertEqual(try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path).draft?.scrollTop, 12)
        var edit = original.cues[0]; edit.source = "after"
        let saved = try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: original.revision, cues: [edit])
        XCTAssertNil(saved.draft)
        let history = try ASSEditStore.history(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path)
        XCTAssertEqual(history.count, 1)
        let restored = try ASSEditStore.restore(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: saved.revision, backupID: history[0].id)
        XCTAssertEqual(restored.cues[0].source, "before")
        var latest = restored
        for index in 0..<22 {
            var cue = latest.cues[0]; cue.source = "version \(index)"
            latest = try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: latest.revision, cues: [cue])
        }
        XCTAssertEqual(try ASSEditStore.history(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path).count, 20)
        try ASSEditStore.persistDraft(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path,
            draft: .init(revision: original.revision, cues: original.cues, index: 0, scrollTop: 0))
        XCTAssertThrowsError(try ASSEditStore.save(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path, revision: original.revision, cues: original.cues))
        XCTAssertEqual(try ASSEditStore.read(mediaURL: fixture.mediaURL, rootDirectory: root, subtitleURL: path).draft?.revision, original.revision)
    }
}
