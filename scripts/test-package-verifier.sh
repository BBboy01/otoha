#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="${1:-}"

if [[ ! -d "$PACKAGE_DIR" ]]; then
  printf 'Plugin package directory not found: %s\n' "$PACKAGE_DIR" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/otoha-package-verifier.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

UNLISTED_PACKAGE="$TEMP_DIR/unlisted-resource.iinaplugin"
cp -R "$PACKAGE_DIR" "$UNLISTED_PACKAGE"
mkdir -p "$UNLISTED_PACKAGE/assets"
printf 'unexpected resource\n' > "$UNLISTED_PACKAGE/assets/unlisted.js"
if bash "$SCRIPT_DIR/verify-plugin-package.sh" "$UNLISTED_PACKAGE"; then
  printf 'Verifier accepted an unlisted package resource.\n' >&2
  exit 1
fi

REPLACED_HELPER_PACKAGE="$TEMP_DIR/replaced-helper.iinaplugin"
cp -R "$PACKAGE_DIR" "$REPLACED_HELPER_PACKAGE"
cp /usr/bin/true "$REPLACED_HELPER_PACKAGE/bin/OtohaHelper.app/Contents/MacOS/otoha-helper"
if bash "$SCRIPT_DIR/verify-plugin-package.sh" "$REPLACED_HELPER_PACKAGE"; then
  printf 'Verifier accepted a replaced helper binary.\n' >&2
  exit 1
fi

printf 'Package verifier rejected unlisted resources and a replaced helper.\n'
