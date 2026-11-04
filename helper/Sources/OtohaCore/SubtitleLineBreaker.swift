import CoreText
import Foundation

struct SubtitleLineBreaker {
    private let fontSize: CGFloat
    private let width: Double
    private let fontName: String
    private var fonts: [String: CTFont] = [:]

    init(fontSize: Int, width: Double, fontName: String = "Arial") {
        self.fontSize = CGFloat(fontSize)
        self.width = max(1, width)
        self.fontName = fontName
    }

    mutating func lines(_ value: String) -> [String] {
        // IINA enables libass Unicode wrapping for converted text, but not native ASS.
        // Plain ASCII can use renderer wrapping unless a single word exceeds the available width.
        let font = CTFontCreateWithName(fontName as CFString, fontSize, nil)
        let fontKey = NSAttributedString.Key(kCTFontAttributeName as String)
        if value.unicodeScalars.allSatisfy(\.isASCII) {
            let measuringFont = normalizedFont(font)
            let hasOversizedWord = value.split(whereSeparator: \.isWhitespace).contains { word in
                let wordText = NSAttributedString(string: String(word), attributes: [fontKey: measuringFont])
                return CTLineGetTypographicBounds(CTLineCreateWithAttributedString(wordText), nil, nil, nil) > width
            }
            guard hasOversizedWord else { return [value] }
        }
        let text = NSMutableAttributedString(
            string: value,
            attributes: [fontKey: font]
        )
        let runs = CTLineGetGlyphRuns(CTLineCreateWithAttributedString(text)) as! [CTRun]
        for run in runs {
            let attributes = CTRunGetAttributes(run) as NSDictionary
            let font = attributes[kCTFontAttributeName] as! CTFont
            let range = CTRunGetStringRange(run)
            text.addAttribute(fontKey, value: normalizedFont(font), range: NSRange(location: range.location, length: range.length))
        }

        let typesetter = CTTypesetterCreateWithAttributedString(text)
        let string = value as NSString
        var offset = 0
        var lines: [String] = []
        while offset < string.length {
            var length = CTTypesetterSuggestLineBreak(typesetter, offset, width)
            if length == 0 {
                length = max(1, CTTypesetterSuggestClusterBreak(typesetter, offset, width))
            }
            let range = string.rangeOfComposedCharacterSequences(for: NSRange(location: offset, length: length))
            lines.append(string.substring(with: range))
            offset = NSMaxRange(range)
        }
        return lines
    }

    private mutating func normalizedFont(_ font: CTFont) -> CTFont {
        let name = CTFontCopyPostScriptName(font) as String
        if let cached = fonts[name] { return cached }
        // libass's REAL_DIM size uses Windows ascent + descent, rather than CoreText's em size.
        let pointSize = fontSize * CGFloat(CTFontGetUnitsPerEm(font)) / fontHeight(font)
        let normalized = CTFontCreateCopyWithAttributes(font, pointSize, nil, nil)
        fonts[name] = normalized
        return normalized
    }

    private func fontHeight(_ font: CTFont) -> CGFloat {
        if let table = CTFontCopyTable(font, CTFontTableTag(kCTFontTableOS2), []) {
            let data = table as Data
            if data.count >= 78 {
                // OpenType OS/2 usWinAscent and usWinDescent are big-endian uint16 at 74 and 76.
                let ascent = Int(data[74]) * 256 + Int(data[75])
                let descent = Int(data[76]) * 256 + Int(data[77])
                if ascent + descent > 0 { return CGFloat(ascent + descent) }
            }
        }
        let pointHeight = CTFontGetAscent(font) + CTFontGetDescent(font)
        return max(1, pointHeight * CGFloat(CTFontGetUnitsPerEm(font)) / CTFontGetSize(font))
    }
}
