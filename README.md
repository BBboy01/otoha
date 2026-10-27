# Otoha

Otoha is an IINA plugin prototype that uses Apple's on-device speech and translation capabilities to generate and load bilingual SRT subtitles for a selected audio track. FFmpeg is supplied by the user through `PATH` or a configured executable path.

The current Mac arm64 prototype is implemented and verified through a real IINA run. The [V1 proposal](docs/iina-transcription-translation-plugin-plan.md) records the agreed behavior and remaining verification gaps. Full translation requires macOS 26.4 or later; the Swift package retains a macOS 26 deployment target and reports this requirement at runtime.

Run focused checks with `npm test --prefix plugin` and `swift test --package-path helper`. Build a plugin bundle for the current Mac with `bash scripts/package-plugin.sh`.

This project is licensed under the [MIT License](LICENSE).
