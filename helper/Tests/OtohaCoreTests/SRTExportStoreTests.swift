import Foundation
import XCTest

@testable import OtohaCore

final class SRTExportStoreTests: XCTestCase {
    func testWritesDistinctExportsWithoutChangingTheSourceASS() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let first = try fixture.export()
        let second = try fixture.export()

        XCTAssertEqual(first.lastPathComponent, "Episode [Source].srt")
        XCTAssertEqual(second.lastPathComponent, "Episode [Source] (2).srt")
        XCTAssertEqual(try String(contentsOf: first, encoding: .utf8), fixture.expectedSRT)
        XCTAssertEqual(try String(contentsOf: second, encoding: .utf8), fixture.expectedSRT)
        XCTAssertEqual(try Data(contentsOf: fixture.subtitleURL), fixture.originalASS)
    }

    func testRejectsAnASSOutsideTheCurrentVideoLibrary() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let outside = fixture.root.appendingPathComponent("outside.ass")
        try fixture.originalASS.write(to: outside)

        XCTAssertThrowsError(try fixture.export(subtitleURL: outside))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: fixture.destination.path), [])
    }

    func testRejectsSymlinkedASSAndExportDirectory() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let outside = fixture.root.appendingPathComponent("outside.ass")
        let linkedASS = fixture.libraryDirectory.appendingPathComponent("Episode (2).ass")
        try fixture.originalASS.write(to: outside)
        try FileManager.default.createSymbolicLink(at: linkedASS, withDestinationURL: outside)
        XCTAssertThrowsError(try fixture.export(subtitleURL: linkedASS))

        let linkedDestination = fixture.root.appendingPathComponent("linked-output", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: linkedDestination, withDestinationURL: fixture.destination)
        XCTAssertThrowsError(try fixture.export(destinationDirectory: linkedDestination))
    }

    func testCreatesTheOtohaExportsDirectoryWithoutModifyingTheASS() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let directory = fixture.root.appendingPathComponent("Exports", isDirectory: true)
        let output = try fixture.export(destinationDirectory: directory)
        XCTAssertEqual(output.deletingLastPathComponent(), directory)
        XCTAssertEqual(try String(contentsOf: output, encoding: .utf8), fixture.expectedSRT)
        XCTAssertEqual(try Data(contentsOf: fixture.subtitleURL), fixture.originalASS)
    }

    func testDoesNotCreateOtherMissingDestinations() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let directory = fixture.root.appendingPathComponent("Unselected", isDirectory: true)
        XCTAssertThrowsError(try fixture.export(destinationDirectory: directory))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    func testRejectsASymlinkAtTheOtohaExportsDirectory() throws {
        let fixture = try Fixture()
        defer { fixture.remove() }
        let directory = fixture.root.appendingPathComponent("Exports", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: directory, withDestinationURL: fixture.destination)
        XCTAssertThrowsError(try fixture.export(destinationDirectory: directory))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: fixture.destination.path), [])
        XCTAssertEqual(try Data(contentsOf: fixture.subtitleURL), fixture.originalASS)
    }

    private struct Fixture {
        let root: URL
        let mediaURL: URL
        let libraryDirectory: URL
        let subtitleURL: URL
        let destination: URL
        let originalASS = Data("""
        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaTranslation,,0,0,0,,你好
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaSource,,0,0,0,,Hello
        """.utf8)
        let expectedSRT = "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n"

        init() throws {
            root = FileManager.default.temporaryDirectory.appendingPathComponent("otoha-srt-test-\(UUID().uuidString)")
            mediaURL = URL(fileURLWithPath: "/tmp/Episode.mkv")
            libraryDirectory = SubtitleLibrary.mediaDirectory(for: mediaURL, rootDirectory: root)
            subtitleURL = libraryDirectory.appendingPathComponent("Episode [en to zh-Hans].ass")
            destination = root.appendingPathComponent("Export", isDirectory: true)
            try FileManager.default.createDirectory(at: libraryDirectory, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
            try originalASS.write(to: subtitleURL)
        }

        func export(subtitleURL: URL? = nil, destinationDirectory: URL? = nil) throws -> URL {
            try SRTExportStore.write(
                subtitleURL: subtitleURL ?? self.subtitleURL,
                mediaURL: mediaURL,
                libraryRoot: root,
                destinationDirectory: destinationDirectory ?? destination,
                mode: .source
            )
        }

        func remove() { try? FileManager.default.removeItem(at: root) }
    }
}
