#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_DIR="${1:-$ROOT_DIR/dist/Otoha.iinaplugin}"

if [[ ! -d "$PACKAGE_DIR" ]]; then
  printf 'Plugin package directory not found: %s\n' "$PACKAGE_DIR" >&2
  exit 1
fi

node - "$PACKAGE_DIR" "$ROOT_DIR/plugin" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const packagePath = path.resolve(process.argv[2]);
const sourcePath = path.resolve(process.argv[3]);
const manifestPath = path.join(packagePath, "Info.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const sourceFiles = fs.readFileSync(
  path.join(sourcePath, "..", "scripts/plugin-files.txt"),
  "utf8",
).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
if (new Set(sourceFiles).size !== sourceFiles.length || sourceFiles.some((filePath) => filePath.startsWith("/") || filePath.includes(".."))) {
  throw new Error("Plugin resource allowlist contains duplicate or unsafe paths.");
}
if (!sourceFiles.includes(manifest.entry) || !sourceFiles.includes(manifest.preferencesPage)) {
  throw new Error("Plugin manifest entry points are missing from the resource allowlist.");
}
const sourcePluginFiles = walk(sourcePath)
  .map((filePath) => path.relative(sourcePath, filePath))
  .filter((filePath) => filePath !== "package.json" && !filePath.startsWith(`test${path.sep}`));
const unlistedPluginFiles = sourcePluginFiles.filter((filePath) => !sourceFiles.includes(filePath));
if (unlistedPluginFiles.length) {
  throw new Error(`Plugin resources are not in the allowlist: ${unlistedPluginFiles.join(", ")}`);
}
const requiredFiles = [
  ...sourceFiles,
  "bin/OtohaHelper.app/Contents/Info.plist",
  "bin/OtohaHelper.app/Contents/MacOS/otoha-helper",
  "bin/OtohaHelper.app/Contents/Resources/helper-source.sha256",
  "bin/OtohaHelper.app/Contents/Resources/helper-binary.sha256",
  "bin/OtohaHelper.app/Contents/Resources/helper-architecture.txt",
];

const allowedPackageFiles = new Set([
  ...sourceFiles,
  "bin/OtohaHelper.app/Contents/Info.plist",
  "bin/OtohaHelper.app/Contents/MacOS/otoha-helper",
  "bin/OtohaHelper.app/Contents/Resources/helper-source.sha256",
  "bin/OtohaHelper.app/Contents/Resources/helper-binary.sha256",
  "bin/OtohaHelper.app/Contents/Resources/helper-architecture.txt",
]);
const packageFiles = walk(packagePath)
  .map((filePath) => path.relative(packagePath, filePath));
const unlistedPackageFiles = packageFiles.filter((relativePath) => !allowedPackageFiles.has(relativePath));
if (unlistedPackageFiles.length) {
  throw new Error(`Package contains unlisted plugin resources: ${unlistedPackageFiles.join(", ")}`);
}

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(packagePath, relativePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`Missing package file: ${relativePath}`);
}
for (const relativePath of sourceFiles) {
  const absolutePath = path.join(packagePath, relativePath);
  const sourceFile = path.join(sourcePath, relativePath);
  if (!fs.readFileSync(absolutePath).equals(fs.readFileSync(sourceFile))) {
    throw new Error(`Package file is stale: ${relativePath}`);
  }
}
if ((fs.statSync(path.join(packagePath, "bin/OtohaHelper.app/Contents/MacOS/otoha-helper")).mode & 0o111) === 0) {
  throw new Error("Bundled helper is not executable.");
}
const helperInfoPath = path.join(packagePath, "bin/OtohaHelper.app/Contents/Info.plist");
const helperInfo = fs.readFileSync(helperInfoPath, "utf8");
if (!helperInfo.includes("com.otoha.helper")) {
  throw new Error("Bundled helper has no expected bundle identifier.");
}
const helperVersion = plistValue(helperInfo, "CFBundleShortVersionString");
if (helperVersion !== manifest.version) {
  throw new Error(`Helper version ${helperVersion || "<missing>"} does not match plugin version ${manifest.version}.`);
}
if (plistValue(helperInfo, "LSMinimumSystemVersion") !== "26.4") {
  throw new Error("Bundled helper must declare macOS 26.4 as its minimum system version.");
}
const helperBinaryPath = path.join(packagePath, "bin/OtohaHelper.app/Contents/MacOS/otoha-helper");
const helperBinaryHash = fs.readFileSync(
  path.join(packagePath, "bin/OtohaHelper.app/Contents/Resources/helper-binary.sha256"),
  "utf8",
).trim().split(/\s+/)[0];
const actualBinaryHash = require("node:child_process")
  .execFileSync("shasum", ["-a", "256", helperBinaryPath], { encoding: "utf8" })
  .trim().split(/\s+/)[0];
if (!helperBinaryHash || helperBinaryHash !== actualBinaryHash) {
  throw new Error("Bundled helper binary hash is stale.");
}
const helperArchitecture = fs.readFileSync(
  path.join(packagePath, "bin/OtohaHelper.app/Contents/Resources/helper-architecture.txt"),
  "utf8",
).trim();
if (!/Mach-O/.test(helperArchitecture) || !/\barm64\b/.test(helperArchitecture)) {
  throw new Error(`Bundled helper is not an arm64 Mach-O binary: ${helperArchitecture}`);
}
const helperSourceManifest = fs.readFileSync(
  path.join(packagePath, "bin/OtohaHelper.app/Contents/Resources/helper-source.sha256"),
  "utf8",
).trim().split(/\r?\n/).filter(Boolean);
const expectedHelperSources = [
  path.join(sourcePath, "../helper/Package.swift"),
  ...walk(path.join(sourcePath, "../helper/Sources")),
].map((filePath) => path.relative(path.resolve(sourcePath, ".."), filePath)).sort();
const actualHelperSources = helperSourceManifest.map((line) => {
  const [hash, ...pathParts] = line.trim().split(/\s+/);
  return `${hash}  ${pathParts.join(" ")}`;
}).sort();
const expectedManifest = expectedHelperSources.map((relativePath) => {
  const hash = require("node:child_process").execFileSync("shasum", ["-a", "256", path.join(sourcePath, "..", relativePath)], { encoding: "utf8" }).trim().split(/\s+/)[0];
  return `${hash}  ${relativePath}`;
}).sort();
if (JSON.stringify(actualHelperSources) !== JSON.stringify(expectedManifest)) {
  throw new Error("Bundled helper source manifest is stale.");
}

console.log(`Verified ${manifest.name} ${manifest.version}: ${packagePath}`);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function plistValue(xml, key) {
  const match = xml.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]+)<\\/string>`));
  return match ? match[1] : "";
}
NODE
