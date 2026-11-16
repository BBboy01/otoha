import XCTest
@testable import OtohaCore

final class SingleLanguageTests: XCTestCase {
    func testPublishesOnlyActualSourceEvents() throws {
        let content = try ASSWriter.serialize(
            [SubtitleCue(start: 0, end: 1, source: "Hello", translation: "")], sourceOnly: true
        )
        let events = content.split(separator: "\n").filter { $0.hasPrefix("Dialogue:") }
        XCTAssertEqual(events.count, 1)
        XCTAssertTrue(events[0].contains("OtohaSource"))
        XCTAssertEqual(try SRTExporter.export(content, mode: .source), "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n")
        XCTAssertThrowsError(try SRTExporter.export(content, mode: .translation))
    }

    func testSingleLanguageNamesAreListed() {
        let media = URL(fileURLWithPath: "/tmp/movie.mp4")
        XCTAssertTrue(SubtitleFilename.isSubtitle(URL(fileURLWithPath: "/tmp/movie [en].ass"), for: media))
        XCTAssertTrue(SubtitleFilename.isSubtitle(URL(fileURLWithPath: "/tmp/movie [en] (2).ass"), for: media))
        XCTAssertFalse(SubtitleFilename.isSubtitle(URL(fileURLWithPath: "/tmp/movie [].ass"), for: media))
    }

    func testSourceEventsRemainExportableWithoutOptionalComment() throws {
        let content = try ASSWriter.serialize(
            [SubtitleCue(start: 0, end: 1, source: "Hello", translation: "")], sourceOnly: true
        ).replacingOccurrences(of: "; OtohaMode: source\n", with: "")
        XCTAssertEqual(try ASSEditDocument(content).mode, "source")
        XCTAssertEqual(try SRTExporter.export(content, mode: .source), "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n")
        XCTAssertThrowsError(try SRTExporter.export(content, mode: .bilingual))
    }
}
