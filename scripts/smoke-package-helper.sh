#!/bin/bash
set -euo pipefail

PACKAGE_DIR="${1:-}"
HELPER_BIN="$PACKAGE_DIR/bin/OtohaHelper.app/Contents/MacOS/otoha-helper"

if [[ ! -x "$HELPER_BIN" ]]; then
  printf 'Packaged helper is missing or not executable: %s\n' "$HELPER_BIN" >&2
  exit 1
fi

invalid_output="$("$HELPER_BIN" --request-json '{}')"
printf '%s\n' "$invalid_output" | node -e '
  const fs = require("node:fs");
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  if (event.type !== "error" || event.code !== "helper.invalidRequest" || event.jobId !== "unknown") process.exit(1);
'

list_output="$("$HELPER_BIN" --list-subtitles-json '{"mediaPath":"/tmp/otoha-sample.mkv","outputDirectoryPath":"/tmp/otoha-subtitles"}')"
printf '%s\n' "$list_output" | node -e '
  const fs = require("node:fs");
  const response = JSON.parse(fs.readFileSync(0, "utf8"));
  if (response.rootDirectoryPath !== "/tmp/otoha-subtitles" || !Array.isArray(response.files)) process.exit(1);
'

if "$HELPER_BIN" --check-languages-json '{"protocolVersion":2,"requestId":"invalid","sourceLanguage":"en","targetLanguage":"ja"}'; then
  printf 'Language preflight accepted an unsupported protocol version.\n' >&2
  exit 1
fi

printf 'Packaged helper CLI smoke tests passed.\n'
node "$(dirname "$0")/test-subtitle-editing.cjs" "$HELPER_BIN"
node "$(dirname "$0")/test-subtitle-style.cjs" "$HELPER_BIN"
