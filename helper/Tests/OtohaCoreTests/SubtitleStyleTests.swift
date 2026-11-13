import XCTest
@testable import OtohaCore

final class SubtitleStyleTests: XCTestCase {
    func testExpandedScaleRangeIsAcceptedByGenerationAndRestyling() throws {
        let cues = [SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")]
        for (scale, sourceSize, translationSize) in [(0.5, 19, 17), (1.37, 52, 47), (3.0, 114, 102)] {
            let generated = try ASSWriter.serialize(cues, scale: scale)
            XCTAssertTrue(generated.contains("Style: OtohaSource,Arial,\(sourceSize),"))
            XCTAssertTrue(generated.contains("Style: OtohaTranslation,Arial,\(translationSize),"))
            let restyled = try SubtitleStyle(scale: scale).applying(to: ASSWriter.serialize(cues))
            XCTAssertTrue(restyled.contains("Style: OtohaSource,Arial,\(sourceSize),"))
        }
        for scale in [0.49, 3.01, Double.nan] {
            XCTAssertThrowsError(try ASSWriter.serialize(cues, scale: scale))
            XCTAssertThrowsError(try SubtitleStyle(scale: scale).validate())
        }
    }

    func testRestylesExistingSubtitleWithoutChangingTimelineOrOriginal() throws {
        let original = try ASSWriter.serialize([SubtitleCue(start: 1, end: 3, source: "Hello", translation: "你好")])
        let style = SubtitleStyle(font: "Menlo", scale: 1.2, color: "#12ABEF", background: true, dimSource: false)
        let result = try style.applying(to: original)
        XCTAssertTrue(result.contains("Style: OtohaSource,Menlo,46,&H00EFAB12,"))
        XCTAssertTrue(result.contains("Style: OtohaTranslation,Menlo,41,&H00EFAB12,"))
        XCTAssertTrue(result.contains(",3,3.5,0,2,"))
        let cues = try ASSEditDocument(result).cues
        XCTAssertEqual(cues[0].start, 1)
        XCTAssertEqual(cues[0].end, 3)
        XCTAssertEqual(cues[0].source, "Hello")
        XCTAssertEqual(cues[0].translation, "你好")
        XCTAssertTrue(original.contains("Style: OtohaSource,Arial,38,"))
        XCTAssertEqual(try style.applying(to: result), result)
    }

    func testStyleRejectsInvalidValues() {
        for style in [
            SubtitleStyle(font: "Arial,42"), SubtitleStyle(scale: .nan),
            SubtitleStyle(scale: 9), SubtitleStyle(color: "red"),
        ] { XCTAssertThrowsError(try style.validate()) }
    }

    func testLargerFontRewrapsLongTextAndPreservesExplicitBreaks() throws {
        let text = String(repeating: "字幕应该根据实际字体重新换行。", count: 20)
        let original = try ASSWriter.serialize([SubtitleCue(start: 0, end: 2, source: "First\nSecond", translation: text)])
        let result = try SubtitleStyle(font: "Menlo", scale: 1.4).applying(to: original)
        let before = try ASSEditDocument(original).cues[0]
        let after = try ASSEditDocument(result).cues[0]
        XCTAssertEqual(after.source, "First\nSecond")
        XCTAssertEqual(after.translation.replacingOccurrences(of: "\n", with: ""), text)
        XCTAssertGreaterThan(after.translation.components(separatedBy: "\n").count, before.translation.components(separatedBy: "\n").count)
        XCTAssertEqual(after.start, before.start)
        XCTAssertEqual(after.end, before.end)
    }

    func testSourceDimmingAndBackgroundOffUseReadableOutline() throws {
        let input = try ASSWriter.serialize([SubtitleCue(start: 0, end: 1, source: "Source", translation: "Translation")])
        let result = try SubtitleStyle().applying(to: input)
        XCTAssertTrue(result.contains("Style: OtohaSource,Arial,38,&H50FFFFFF,"))
        XCTAssertTrue(result.contains(",1,3.5,1.5,2,"))
    }
}
