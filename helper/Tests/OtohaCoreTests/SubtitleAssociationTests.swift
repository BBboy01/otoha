import Darwin
import Foundation
import XCTest
@testable import OtohaCore

final class SubtitleAssociationTests: XCTestCase {
    func testBrowseOneLevelAndCopyWithoutChangingOriginal() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let oldMedia = fixture.directory.appendingPathComponent("old.mp4")
        let oldDirectory = SubtitleLibrary.mediaDirectory(for: oldMedia, rootDirectory: root)
        try FileManager.default.createDirectory(at: oldDirectory, withIntermediateDirectories: true)
        let source = oldDirectory.appendingPathComponent("old [en to ja].ass")
        let text = try ASSWriter.serialize([.init(start: 0, end: 2, source: "Hello", translation: "こんにちは")])
        try Data(text.utf8).write(to: source)
        XCTAssertEqual(try SubtitleAssociation.browse(rootDirectory: root).map(\.kind), ["directory"])
        XCTAssertEqual(try SubtitleAssociation.browse(rootDirectory: root, directoryURL: oldDirectory).map(\.name), [source.lastPathComponent])
        let first = try SubtitleAssociation.copy(subtitleURL: source, mediaURL: fixture.mediaURL, rootDirectory: root)
        let second = try SubtitleAssociation.copy(subtitleURL: source, mediaURL: fixture.mediaURL, rootDirectory: root)
        XCTAssertNotEqual(first, second)
        var originalInfo = stat(), copiedInfo = stat()
        XCTAssertEqual(stat(source.path, &originalInfo), 0)
        XCTAssertEqual(stat(first.path, &copiedInfo), 0)
        XCTAssertNotEqual(originalInfo.st_ino, copiedInfo.st_ino)
        XCTAssertTrue(SubtitleFilename.isSubtitle(first, for: fixture.mediaURL))
        XCTAssertEqual(try String(contentsOf: first, encoding: .utf8), text)
        try Data("new edit".utf8).write(to: first)
        XCTAssertEqual(try String(contentsOf: source, encoding: .utf8), text)
    }

    func testSourceOnlyAndNumberedVersionRemainDiscoverableAfterCopy() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let oldMedia = fixture.directory.appendingPathComponent("old.mp4")
        let directory = SubtitleLibrary.mediaDirectory(for: oldMedia, rootDirectory: root)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("old [en] (2).ass")
        let text = try ASSWriter.serialize([.init(start: 0, end: 2, source: "Hello", translation: "")], sourceOnly: true)
        try Data(text.utf8).write(to: source)
        for _ in 0..<2 {
            let copied = try SubtitleAssociation.copy(subtitleURL: source, mediaURL: fixture.mediaURL, rootDirectory: root)
            XCTAssertTrue(SubtitleFilename.isSubtitle(copied, for: fixture.mediaURL))
            XCTAssertEqual(try String(contentsOf: copied, encoding: .utf8), text)
        }
        XCTAssertEqual(try SubtitleLibrary.list(for: fixture.mediaURL, rootDirectory: root).count, 2)
    }

    func testRejectEscapesSymlinksAndInvalidContent() throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let root = fixture.directory.appendingPathComponent("library")
        let oldDirectory = root.appendingPathComponent("old-0123456789abcdef")
        try FileManager.default.createDirectory(at: oldDirectory, withIntermediateDirectories: true)
        let file = oldDirectory.appendingPathComponent("old.ass")
        try Data("invalid".utf8).write(to: file)
        XCTAssertThrowsError(try SubtitleAssociation.copy(subtitleURL: file, mediaURL: fixture.mediaURL, rootDirectory: root))
        XCTAssertThrowsError(try SubtitleAssociation.browse(rootDirectory: root, directoryURL: fixture.directory))
        let linkedDirectory = root.appendingPathComponent("link-0123456789abcdef")
        try FileManager.default.createSymbolicLink(at: linkedDirectory, withDestinationURL: oldDirectory)
        XCTAssertFalse(try SubtitleAssociation.browse(rootDirectory: root).contains { $0.path == linkedDirectory.path })
        XCTAssertThrowsError(try SubtitleAssociation.browse(rootDirectory: root, directoryURL: linkedDirectory))
        let link = oldDirectory.appendingPathComponent("linked.ass")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.mediaURL)
        XCTAssertThrowsError(try SubtitleAssociation.copy(subtitleURL: link, mediaURL: fixture.mediaURL, rootDirectory: root))
        XCTAssertThrowsError(try SubtitleAssociation.copy(subtitleURL: fixture.mediaURL, mediaURL: fixture.mediaURL, rootDirectory: root))
        XCTAssertFalse(FileManager.default.fileExists(atPath: SubtitleLibrary.mediaDirectory(for: fixture.mediaURL, rootDirectory: root).path))
    }
}
