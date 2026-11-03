.DEFAULT_GOAL := help
SHELL := /bin/bash

PACKAGE_DIR ?= dist/Otoha.iinaplugin
ARCHIVE_DIR ?= dist

.PHONY: \
	help \
	test \
	test-plugin \
	test-helper \
	build-helper \
	package \
	verify-package \
	test-package-integrity \
	smoke-package-helper \
	ci \
	archive \
	clean-package

help:
	@printf '%s\n' \
	  'make test                    Run plugin and helper tests' \
	  'make build-helper            Build the release helper' \
	  'make package                 Build dist/Otoha.iinaplugin (or set PACKAGE_DIR)' \
	  'make verify-package          Verify the plugin package' \
	  'make ci                      Run tests and package checks' \
	  'make clean-package           Remove the default package output' \
	  'make archive RELEASE_TAG=vX  Build and verify a release archive'

test: test-plugin test-helper

test-plugin:
	npm test --prefix plugin

test-helper:
	swift test --package-path helper

build-helper:
	swift build -c release --package-path helper

package:
	bash scripts/package-plugin.sh "$(PACKAGE_DIR)"

verify-package:
	bash scripts/verify-plugin-package.sh "$(PACKAGE_DIR)"

test-package-integrity:
	bash scripts/test-package-verifier.sh "$(PACKAGE_DIR)"

smoke-package-helper:
	bash scripts/smoke-package-helper.sh "$(PACKAGE_DIR)"

ci:
	$(MAKE) test
	$(MAKE) package PACKAGE_DIR="$(PACKAGE_DIR)"
	$(MAKE) verify-package PACKAGE_DIR="$(PACKAGE_DIR)"
	$(MAKE) test-package-integrity PACKAGE_DIR="$(PACKAGE_DIR)"
	$(MAKE) smoke-package-helper PACKAGE_DIR="$(PACKAGE_DIR)"

archive: verify-package
	@test -n "$${RELEASE_TAG:-}" || { printf 'Set RELEASE_TAG, for example RELEASE_TAG=v0.1.0.\n' >&2; exit 2; }
	@mkdir -p "$(ARCHIVE_DIR)"
	@archive_path="$$(cd "$(ARCHIVE_DIR)" && pwd)/Otoha-$${RELEASE_TAG}-macos-arm64.iinaplgz"; \
	  test ! -e "$$archive_path" || { printf 'Archive already exists: %s\n' "$$archive_path" >&2; exit 1; }; \
	  (cd "$(PACKAGE_DIR)" && zip -r "$$archive_path" *); \
	  unzip -t "$$archive_path"

clean-package:
	@if [[ -L dist || -L dist/Otoha.iinaplugin ]]; then \
	  printf 'Refusing to remove a symlinked package path.\n' >&2; exit 1; \
	fi
	rm -rf dist/Otoha.iinaplugin
