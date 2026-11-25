import Foundation
import XCTest
@testable import OtohaCore

final class HelperProtocolContractTests: XCTestCase {
    func testSwiftEventsAreConsumedByProductionJavaScriptParser() throws {
        let events: [HelperEvent] = [
            .phase(.transcribing, message: "Listening"),
            .phase(.translating, message: "Translating", progress: 0.4),
            .completed(path: URL(fileURLWithPath: "/tmp/contract.ass")),
            .cancelled(),
            .failure(code: .speechNoSpeech, message: "No speech")
        ]
        let jsonl = try events.map { try $0.with(jobId: "contract-job").jsonLine() }.joined(separator: "\n")
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", root.appendingPathComponent("scripts/test-helper-protocol.cjs").path, "--stdin"]
        let input = Pipe()
        let output = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = output
        try process.run()
        try input.fileHandleForWriting.write(contentsOf: Data(jsonl.utf8))
        try input.fileHandleForWriting.close()
        let response = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0, String(decoding: response, as: UTF8.self))
    }
}
