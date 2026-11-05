const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const plugin = path.resolve(__dirname, "..");
const stylesheets = fs
  .readdirSync(plugin)
  .filter((file) => file.endsWith(".css"));
const read = (file) => fs.readFileSync(path.join(plugin, file), "utf8");

test("both entry points load the shared theme before component styles", () => {
  const manifest = read("../scripts/plugin-files.txt").split(/\r?\n/);
  for (const entry of ["sidebar.html", "preferences.html"]) {
    const links = [
      ...read(entry).matchAll(/<link\b[^>]*href="([^"]+\.css)"/g),
    ].map((match) => match[1]);
    assert.equal(links[0], "theme.css", entry);
    for (const file of links) {
      assert.ok(
        manifest.includes(file),
        `${entry}: ${file} must ship in the plugin`,
      );
      assert.ok(fs.existsSync(path.join(plugin, file)), file);
    }
    assert.doesNotMatch(
      read(entry),
      /<style\b|\bstyle="/,
      `${entry}: keep styles in stylesheets`,
    );
  }
});

test("component theme references are namespaced and defined by the shared theme", () => {
  const definitions = new Set(
    [...read("theme.css").matchAll(/(--otoha-[\w-]+)\s*:/g)].map(
      (match) => match[1],
    ),
  );
  assert.ok(definitions.size > 0);
  for (const file of stylesheets) {
    for (const match of read(file).matchAll(/var\(\s*(--[\w-]+)/g)) {
      assert.ok(
        match[1].startsWith("--otoha-"),
        `${file}: ${match[1]} needs the theme namespace`,
      );
      assert.ok(definitions.has(match[1]), `${file}: undefined ${match[1]}`);
    }
  }
});

test("component styles use theme values instead of literal dimensions and colors", () => {
  for (const file of stylesheets.filter((file) => file !== "theme.css")) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      // Inspect declaration values, leaving selectors and query constants alone.
      for (const [, value] of line.matchAll(
        /(?:^|[;{])\s*[\w-]+\s*:\s*([^;{}]+)/g,
      )) {
        assert.doesNotMatch(
          value,
          /\b\d+(?:\.\d+)?(?:px|rem|em|ms)\b|#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|color-mix)\(/i,
          `${file}:${index + 1}: define design values in theme.css`,
        );
      }
    }
  }
});
