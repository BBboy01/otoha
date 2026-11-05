import XCTest

@testable import OtohaCore

final class SRTExporterTests: XCTestCase {
    func testExportsSourceTranslationAndBilingualModesWithCueTimes() throws {
        XCTAssertEqual(try export(.source), "1\n00:00:01,230 --> 00:00:02,000\nHello, {world}\nagain\n\n")
        XCTAssertEqual(try export(.translation), "1\n00:00:01,230 --> 00:00:02,000\n你好\n\n")
        XCTAssertEqual(try export(.bilingual), "1\n00:00:01,230 --> 00:00:02,000\nHello, {world}\nagain\n你好\n\n")
    }

    func testPreservesMillisecondASSTimesAndSortsEventsChronologically() throws {
        let ass = """
        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:03.12,0:00:04.56,OtohaTranslation,,0,0,0,,later译文
        Dialogue: 0,0:00:03.12,0:00:04.56,OtohaSource,,0,0,0,,later
        Dialogue: 0,0:00:00.01,0:00:00.99,OtohaTranslation,,0,0,0,,earlier译文
        Dialogue: 0,0:00:00.01,0:00:00.99,OtohaSource,,0,0,0,,earlier
        """

        XCTAssertEqual(
            try SRTExporter.export(ass, mode: .source),
            "1\n00:00:00,010 --> 00:00:00,990\nearlier\n\n2\n00:00:03,120 --> 00:00:04,560\nlater\n\n"
        )
    }

    func testEscapesHTMLAndSkipsASSOverrideTagsWithoutLosingLiteralEscapes() throws {
        let ass = """
        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaTranslation,,0,0,0,,翻译
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaSource,,0,0,0,,<b>{\\i1}tag{\\i0}</b> \\\\N literal
        """

        XCTAssertEqual(
            try SRTExporter.export(ass, mode: .source),
            "1\n00:00:00,000 --> 00:00:01,000\n&lt;b&gt;tag&lt;/b&gt; \\N literal\n\n"
        )
    }

    func testIgnoresEmptySelectedTextAndFailsWhenNoUsableCuesRemain() throws {
        let ass = """
        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaTranslation,,0,0,0,,译文
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaSource,,0,0,0,,
        """

        XCTAssertThrowsError(try SRTExporter.export(ass, mode: .source))
        XCTAssertEqual(
            try SRTExporter.export(ass, mode: .translation),
            "1\n00:00:00,000 --> 00:00:01,000\n译文\n\n"
        )
    }

    func testRejectsUnmatchedOrMalformedDialogueInsteadOfExportingPartialData() {
        let unmatched = """
        [Events]
        Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
        Dialogue: 0,0:00:00.00,0:00:01.00,OtohaSource,,0,0,0,,原文
        """
        XCTAssertThrowsError(try SRTExporter.export(unmatched, mode: .bilingual))
        XCTAssertThrowsError(try SRTExporter.export("[Events]\nFormat: Start, End, Style, Text\nDialogue: broken", mode: .source))
    }

    private func export(_ mode: SRTExportMode) throws -> String {
        try SRTExporter.export(
            """
            [Script Info]
            ScriptType: v4.00+

            [Events]
            Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
            Dialogue: 0,0:00:01.23,0:00:02.00,OtohaTranslation,,0,0,0,,你好
            Dialogue: 0,0:00:01.23,0:00:02.00,OtohaSource,,0,0,0,,Hello, \\{world\\}\\Nagain
            """,
            mode: mode
        )
    }
}
