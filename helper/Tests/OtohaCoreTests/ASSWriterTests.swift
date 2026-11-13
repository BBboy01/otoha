import XCTest

@testable import OtohaCore

final class ASSWriterTests: XCTestCase {
    func testUsesSelectedFontForBothLanguages() throws {
        let ass = try ASSWriter.serialize(
            [SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")],
            fontName: "PingFang SC"
        )
        XCTAssertTrue(ass.contains("Style: OtohaSource,PingFang SC,38,"))
        XCTAssertTrue(ass.contains("Style: OtohaTranslation,PingFang SC,34,"))
    }

    func testRejectsFontNamesThatCouldCorruptASS() {
        for name in ["", "  ", "Arial,42", "Arial\nStyle: injected", "Arial\0", String(repeating: "x", count: 129)] {
            XCTAssertThrowsError(try ASSWriter.serialize(
                [SubtitleCue(start: 0, end: 1, source: "Hello", translation: "你好")],
                fontName: name
            ))
        }
    }

    func testSortsCuesAndKeepsSourceAboveTranslation() throws {
        let ass = try ASSWriter.serialize([
            SubtitleCue(start: 1.2345, end: 2, source: "Hello", translation: "你好"),
            SubtitleCue(start: 0, end: 1.25, source: "First", translation: "第一句"),
        ])

        XCTAssertTrue(ass.hasPrefix("[Script Info]\n"))
        XCTAssertTrue(ass.contains("Style: OtohaSource,Arial,38,&H50FFFFFF,"))
        XCTAssertTrue(ass.contains("Style: OtohaTranslation,Arial,34,&H00FFFFFF,"))
        let events = ass.split(separator: "\n").filter { $0.hasPrefix("Dialogue:") }
        XCTAssertEqual(
            events.map(String.init),
            [
                "Dialogue: 0,0:00:00.00,0:00:01.25,OtohaTranslation,,0,0,0,,第一句",
                "Dialogue: 0,0:00:00.00,0:00:01.25,OtohaSource,,0,0,0,,First",
                "Dialogue: 0,0:00:01.23,0:00:02.00,OtohaTranslation,,0,0,0,,你好",
                "Dialogue: 0,0:00:01.23,0:00:02.00,OtohaSource,,0,0,0,,Hello",
            ])
    }

    func testEscapesASSCommandsAndPreservesExplicitLineBreaks() throws {
        let ass = try serialize(source: "Hello {world}\r\nagain", translation: "你好\\there")
        XCTAssertTrue(ass.contains("Hello \\{world\\}\\Nagain"))
        XCTAssertTrue(ass.contains("你好\\\\there"))
    }

    func testScalesFontSizes() throws {
        let ass = try serialize(scale: 1.2)
        XCTAssertTrue(ass.contains("Style: OtohaSource,Arial,46,"))
        XCTAssertTrue(ass.contains("Style: OtohaTranslation,Arial,41,"))
    }

    func testLetsRendererWrapEnglishUsingAvailableWidth() throws {
        let translation = "I think the original picture is very beautiful, and the composition is quite charming."
        let ass = try serialize(translation: translation)

        XCTAssertTrue(ass.contains("WrapStyle: 1\n"))
        XCTAssertTrue(ass.contains(",OtohaTranslation,,0,0,0,,\(translation)\n"))
    }

    func testBreaksASCIIWordsThatCannotFitOnOneLine() throws {
        let translation = String(repeating: "W", count: 300)
        let ass = try serialize(translation: translation)
        XCTAssertGreaterThan(textLines(ass).count, 1)
        XCTAssertEqual(textLines(ass).joined(), translation)
    }

    func testLayoutDependsOnAspectRatioRatherThanPixelResolution() throws {
        let translation = String(repeating: "一段足够长的中文用来验证画面比例决定换行。", count: 6)
        let hd = try serialize(translation: translation, width: 1280, height: 720)
        let fullHD = try serialize(translation: translation, width: 1920, height: 1080)
        let qhd = try serialize(translation: translation, width: 2560, height: 1440)

        XCTAssertEqual(hd, fullHD)
        XCTAssertEqual(fullHD, qhd)
        XCTAssertTrue(fullHD.contains("PlayResX: 1920\nPlayResY: 1080\n"))
        XCTAssertTrue(fullHD.contains(",2,96,96,20,1"))
    }

    func testNarrowPictureAndLargerFontProduceMoreCJKLines() throws {
        let translation = String(repeating: "字幕应该根据字形宽度自然换行，保留所有内容。", count: 6)
        let landscape = try serialize(translation: translation)
        let portrait = try serialize(translation: translation, width: 1080, height: 1920)
        let largeFont = try serialize(translation: translation, scale: 1.4)

        XCTAssertGreaterThan(textLines(portrait).count, textLines(landscape).count)
        XCTAssertGreaterThan(textLines(largeFont).count, textLines(landscape).count)
        XCTAssertTrue(portrait.contains("PlayResX: 608\nPlayResY: 1080\n"))
        XCTAssertEqual(textLines(portrait).joined(), translation)
    }

    func testMeasuresFallbackFontUsingASSRatherThanCoreTextPointSize() throws {
        let translation = String(repeating: "译", count: 65)
        let ass = try serialize(translation: translation)
        XCTAssertEqual(textLines(ass), [translation])
    }

    func testUsesGlyphWidthsAndLanguageBoundariesForMixedText() throws {
        let narrowGlyphs = String(repeating: "i", count: 120)
        let wideGlyphs = String(repeating: "W", count: 120)
        let narrow = try serialize(translation: "中文 \(narrowGlyphs) ending")
        let wide = try serialize(translation: "中文 \(wideGlyphs) ending")

        XCTAssertGreaterThan(textLines(wide).count, textLines(narrow).count)
        let mixed = "「これは字幕の折り返しです。」English words stay together. 👨‍👩‍👧‍👦 "
        let ass = try serialize(translation: mixed, width: 1080, height: 1920)
        let lines = textLines(ass)
        XCTAssertEqual(lines.joined().filter { !$0.isWhitespace }, mixed.filter { !$0.isWhitespace })
        XCTAssertFalse(lines.contains { $0.hasPrefix("。」") || $0.hasSuffix("「") })
        XCTAssertFalse(ass.contains("wor\\Nds"))
    }

    func testUsesDefaultCanvasWhenDimensionsAreMissingOrInvalid() throws {
        let fallback = try serialize()
        XCTAssertEqual(try serialize(width: 0, height: 720), fallback)
        XCTAssertEqual(try serialize(width: 1920, height: -1), fallback)
        XCTAssertEqual(try serialize(width: Int.max, height: 1), fallback)
    }

    private func serialize(
        source: String = "原文", translation: String = "译文", scale: Double = 1,
        width: Int? = nil, height: Int? = nil
    ) throws -> String {
        try ASSWriter.serialize(
            [SubtitleCue(start: 0, end: 1, source: source, translation: translation)],
            scale: scale, videoWidth: width, videoHeight: height
        )
    }

    private func textLines(_ ass: String) -> [String] {
        let event = ass.split(separator: "\n").first {
            $0.hasPrefix("Dialogue:") && $0.contains(",OtohaTranslation,")
        }!
        let text = event.split(separator: ",", maxSplits: 9, omittingEmptySubsequences: false)[9]
        return text.components(separatedBy: "\\N")
    }
}
