import Foundation
import XCTest
@testable import OtohaCore

final class SubtitleStructureTests: XCTestCase {
    func testSourceOnlyCanBeEditedWithoutInventingTranslation() throws {
        let ass = try ASSWriter.serialize([.init(start: 1, end: 2, source: "one", translation: "一")])
        let source = ass.components(separatedBy: "\n").filter { !$0.hasPrefix("Dialogue:") || !$0.contains("OtohaTranslation") }.joined(separator: "\n")
        let document = try ASSEditDocument(source)
        XCTAssertEqual(document.mode, "source")
        var cue = document.cues[0]
        cue.start = 0.5
        cue.source = "changed"
        let edited = try document.replacingCues([cue])
        XCTAssertFalse(edited.contains("Dialogue: 0,0:00:00.50,0:00:02.00,OtohaTranslation"))
        XCTAssertEqual(try ASSEditDocument(edited).cues[0].start, 0.5)
    }

    func testMergeAndSplitPreserveHeadersAndForeignEvents() throws {
        let ass = try ASSWriter.serialize([
            .init(start: 1, end: 2, source: "one", translation: "一"),
            .init(start: 3, end: 4, source: "two", translation: "二")]) + "Comment: keep untouched\n"
        let doc = try ASSEditDocument(ass)
        let merged = ASSEditCue(id: "new", origins: doc.cues.map(\.id), start: 1, end: 4, source: "one\ntwo", translation: "一\n二")
        let result = try doc.replacingCues([merged])
        XCTAssertTrue(result.hasPrefix(ass.components(separatedBy: "[Events]")[0]))
        XCTAssertTrue(result.contains("Comment: keep untouched"))
        XCTAssertEqual(try ASSEditDocument(result).cues.count, 1)
        let cue = doc.cues[0]
        let left = ASSEditCue(id: "left", origins: [cue.id], start: 1, end: 1.5, source: "o", translation: "一")
        let right = ASSEditCue(id: "right", origins: [cue.id], start: 1.5, end: 2, source: "ne", translation: "字")
        XCTAssertEqual(try ASSEditDocument(doc.replacingCues([left, right, doc.cues[1]])).cues.count, 3)
    }

    func testRejectsInvalidOriginsAndTimes() throws {
        let doc = try ASSEditDocument(ASSWriter.serialize([.init(start: 0, end: 2, source: "x", translation: "y")]))
        var cue = doc.cues[0]
        cue.start = -1
        XCTAssertThrowsError(try doc.replacingCues([cue]))
        cue.start = 0
        cue.origins = ["foreign"]
        XCTAssertThrowsError(try doc.replacingCues([cue]))
    }

    func testLargeUnchangedDocumentRetainsItsExactEvents() throws {
        let content = try ASSWriter.serialize((0..<2_000).map { index in
            .init(start: Double(index * 2), end: Double(index * 2 + 1), source: "source \(index)", translation: "译文 \(index)")
        })
        let document = try ASSEditDocument(content)
        XCTAssertEqual(try document.replacingCues(document.cues), content)
    }
}
