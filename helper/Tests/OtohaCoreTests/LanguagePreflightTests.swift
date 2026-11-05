import Foundation
import XCTest
@testable import OtohaCore

final class LanguagePreflightTests: XCTestCase {
    func testCancellationAfterPreflightPreservesExistingSubtitle() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let cancellationURL = fixture.directory.appendingPathComponent("cancel")
        let outputURL = fixture.directory.appendingPathComponent("movie ; $ input [ja-JP to en-US].ass")
        try Data("existing synthetic subtitle".utf8).write(to: outputURL)
        let runner = SubtitleJobRunner(dependencies: .init(
            preflight: { try Data().write(to: cancellationURL) },
            prepareTranslation: { throw FixtureError.unexpectedDependencyCall },
            transcribe: { throw FixtureError.unexpectedDependencyCall },
            translate: { _ in throw FixtureError.unexpectedDependencyCall }
        ))
        do {
            _ = try await runner.run(configuration: fixture.configuration(),
                                     cancellation: JobCancellationToken(cancellationFileURL: cancellationURL))
            XCTFail("Expected cancellation")
        } catch is CancellationError {}
        XCTAssertEqual(try String(contentsOf: outputURL, encoding: .utf8), "existing synthetic subtitle")
    }
    func testFailedPreflightDoesNotStartWorkOrCreateOutputDirectory() async throws {
        let fixture = try Fixture()
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let output = fixture.directory.appendingPathComponent("not-created")
        let result = LanguagePreflightResult(requestId: "blocked", sourceLanguage: "en", targetLanguage: "ja",
                                            speech: .unsupported, translation: .installed)
        let runner = SubtitleJobRunner(dependencies: .init(
            preflight: { throw LanguagePreflightFailure(result) },
            prepareTranslation: { throw FixtureError.unexpectedDependencyCall },
            transcribe: { throw FixtureError.unexpectedDependencyCall },
            translate: { _ in throw FixtureError.unexpectedDependencyCall }
        ))
        do {
            _ = try await runner.run(configuration: fixture.configuration(outputDirectory: output), cancellation: JobCancellationToken())
            XCTFail("Expected blocked preflight")
        } catch let failure as LanguagePreflightFailure {
            XCTAssertEqual(failure.result.errorCode, .speechUnsupportedLanguage)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: output.path))
    }
    func testAvailabilityDistinguishesUnsupportedAndMissingResources() throws {
        let supported = LanguagePreflightResult(
            requestId: "check-1", sourceLanguage: "en", targetLanguage: "ja",
            speech: .supported, translation: .installed
        )
        XCTAssertTrue(supported.canGenerate)
        XCTAssertNil(supported.errorCode)
        XCTAssertEqual(LanguagePreflightResult(
            requestId: "check-2", sourceLanguage: "en", targetLanguage: "ja",
            speech: .unsupported, translation: .installed
        ).errorCode, .speechUnsupportedLanguage)
        XCTAssertEqual(LanguagePreflightResult(
            requestId: "check-3", sourceLanguage: "en", targetLanguage: "ja",
            speech: .installed, translation: .unsupported
        ).errorCode, .translationUnsupportedLanguage)
        let missing = LanguagePreflightResult(
            requestId: "check-4", sourceLanguage: "en", targetLanguage: "ja",
            speech: .installed, translation: .supported
        )
        XCTAssertFalse(missing.canGenerate)
        XCTAssertEqual(missing.errorCode, .translationResourcesMissing)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(supported)) as! [String: Any]
        XCTAssertEqual(json["protocolVersion"] as? Int, 1)
        XCTAssertEqual(json["requestId"] as? String, "check-1")
        XCTAssertNil(json["path"])
    }

    func testPreflightRequestRejectsInvalidVersionAndLanguagesWithoutAnyFiles() throws {
        for (version, source, target, id) in [(2, "en", "ja", "one"), (1, "en", "en", "two"),
                                             (1, "", "ja", "three"), (1, "en", "ja", "")] {
            let data = try JSONSerialization.data(withJSONObject: [
                "protocolVersion": version, "requestId": id,
                "sourceLanguage": source, "targetLanguage": target,
            ])
            let request = try JSONDecoder().decode(LanguagePreflightRequest.self, from: data)
            XCTAssertThrowsError(try request.validate())
        }
    }
}
