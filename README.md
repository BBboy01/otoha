# Otoha

Otoha is an IINA plugin prototype that uses Apple's on-device speech and translation capabilities to generate and load bilingual ASS subtitles for a selected audio track. Generated ASS styles keep the translation at normal brightness and render the source language smaller and faded. FFmpeg is supplied by the user through `PATH` or a configured executable path.

Set default source and target languages in the plugin preferences. Each video remembers the language pair from its last successful generation; changing global defaults does not overwrite it. Automatic loading restores the last selected existing subtitle, or the newest available version, without starting transcription. Generate subtitles manually: an existing language pair is replaced only after successful generation, while other language versions are kept. Choose source-only, translation-only, or bilingual display for each video; new videos default to bilingual and remember their own display choice.

The current Mac arm64 prototype is implemented and verified through a real IINA run. The [V1 proposal](docs/iina-transcription-translation-plugin-plan.md) records the agreed behavior and remaining verification gaps. Full translation requires macOS 26.4 or later; the Swift package retains a macOS 26 deployment target and reports this requirement at runtime.

Run focused checks with `npm test --prefix plugin` and `swift test --package-path helper`. Build a plugin bundle for the current Mac with `bash scripts/package-plugin.sh`.

GitHub Actions runs both test suites and verifies an arm64 plugin bundle. Push a `v*` tag matching `plugin/Info.json` to create a GitHub Release with notes generated from Conventional Commits by git-cliff and a downloadable `Otoha-<tag>-macos-arm64.iinaplgz` package. Open the downloaded package with IINA, or install it from IINA's Plugins preferences. Preview unreleased notes locally with `git cliff --unreleased`.

This project is licensed under the [MIT License](LICENSE).
