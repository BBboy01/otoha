#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
scratch_dir="$(mktemp -d /tmp/otoha-picker-tests.XXXXXX)"
trap 'rm -rf "$scratch_dir"' EXIT
swiftc -swift-version 6 -parse-as-library "$project_dir/helper/Sources/OtohaHelper/SubtitleImportPickerCLI.swift" \
  "$project_dir/scripts/test-subtitle-import-picker.swift" -o "$scratch_dir/picker-tests"
"$scratch_dir/picker-tests"
