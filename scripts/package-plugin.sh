#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$ROOT_DIR/plugin"
HELPER_DIR="$ROOT_DIR/helper"
HELPER_INFO_PLIST="$HELPER_DIR/Resources/Info.plist"
PACKAGE_DIR="${1:-$ROOT_DIR/dist/Otoha.iinaplugin}"

if [[ -e "$PACKAGE_DIR" ]]; then
  printf 'Output already exists: %s\nMove it or choose another output path.\n' "$PACKAGE_DIR" >&2
  exit 1
fi

swift build -c release --package-path "$HELPER_DIR"
BUILD_DIR="$(swift build -c release --package-path "$HELPER_DIR" --show-bin-path)"
HELPER_BIN="$BUILD_DIR/otoha-helper"
if [[ ! -x "$HELPER_BIN" ]]; then
  printf 'Built helper is missing or not executable: %s\n' "$HELPER_BIN" >&2
  exit 1
fi
if [[ ! -f "$HELPER_INFO_PLIST" ]]; then
  printf 'Helper bundle metadata is missing: %s\n' "$HELPER_INFO_PLIST" >&2
  exit 1
fi

HELPER_APP_DIR="$PACKAGE_DIR/bin/OtohaHelper.app"
mkdir -p "$HELPER_APP_DIR/Contents/MacOS" "$HELPER_APP_DIR/Contents/Resources"
cp "$PLUGIN_DIR/Info.json" "$PLUGIN_DIR/main.js" "$PLUGIN_DIR/controller.js" "$PLUGIN_DIR/subtitle-settings.js" "$PLUGIN_DIR/subtitle-display.js" \
  "$PLUGIN_DIR/sidebar.html" "$PLUGIN_DIR/sidebar.css" "$PLUGIN_DIR/sidebar.js" \
  "$PLUGIN_DIR/preferences.html" "$PACKAGE_DIR/"
cp "$HELPER_BIN" "$HELPER_APP_DIR/Contents/MacOS/otoha-helper"
cp "$HELPER_INFO_PLIST" "$HELPER_APP_DIR/Contents/Info.plist"
chmod u+x "$HELPER_APP_DIR/Contents/MacOS/otoha-helper"

(
  cd "$ROOT_DIR"
  {
    shasum -a 256 helper/Package.swift
    find helper/Sources -type f -print | sort | while IFS= read -r source_file; do
      shasum -a 256 "$source_file"
    done
  }
) > "$HELPER_APP_DIR/Contents/Resources/helper-source.sha256"

printf 'Packaged current Mac plugin: %s\n' "$PACKAGE_DIR"
