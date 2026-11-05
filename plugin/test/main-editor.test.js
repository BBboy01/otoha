const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture");
const path = "/Users/test/Anime episode [ja to zh-Hans].ass";
const media = "/Users/test/Anime episode.mkv";
const content = `[Script Info]\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, MarginV\nStyle: OtohaSource,Arial,38,74\nStyle: OtohaTranslation,Arial,34,20\n[Events]\nFormat: Layer, Start, End, Style, Name, Text\nDialogue: 0,0:00:01.00,0:00:02.00,OtohaSource,,自作テスト\nDialogue: 0,0:00:01.00,0:00:02.00,OtohaTranslation,,自编测试\n`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const mode of ["source", "translation", "bilingual"]) {
  test(`editor saves and reloads ${mode} once without changing video language memory`, async () => {
    const plugin = createPlugin({
      autoLoad: true,
      existingSubtitles: [path],
      subtitleContents: { [path]: content },
      savedPreferences: {
        video_settings: JSON.stringify({
          [media]: {
            sourceLanguage: "ja",
            targetLanguage: "zh-Hans",
            displayMode: mode,
            subtitlePath: path,
          },
        }),
      },
      subtitleEditSnapshot: {
        path,
        revision: "a".repeat(64),
        cues: [
          { start: 1, end: 2, source: "自作テスト", translation: "自编测试" },
        ],
      },
      editedSubtitleContent: content
        .replace("自作テスト", "修正テスト")
        .replace("自编测试", "修改测试"),
    });
    plugin.runSidebarLoad();
    await plugin.sidebarHandlers.get("ready")({ helperPath });
    await tick();
    const beforeLoads = plugin.loadedTracks.length;
    const preferences = plugin.preferenceValues.video_settings;
    await plugin.sidebarHandlers.get("editSubtitle")(path);
    const opened = plugin.messages.findLast(
      (item) => item.name === "editor",
    ).payload;
    assert.equal(opened.status, "ready");
    await plugin.sidebarHandlers.get("saveSubtitleEdits")({
      sessionId: opened.sessionId,
      texts: [{ source: "修正テスト", translation: "修改测试" }],
    });
    await tick();
    assert.equal(
      plugin.messages.findLast((item) => item.name === "editor").payload.status,
      "saved",
    );
    assert.equal(
      plugin.mpvCommands.filter((item) => item.name === "sub-reload").length,
      1,
    );
    assert.equal(plugin.loadedTracks.length, beforeLoads);
    assert.equal(plugin.preferenceValues.video_settings, preferences);
    assert.equal(
      plugin.messages.findLast((item) => item.name === "state").payload
        .displayMode,
      mode,
    );
    if (mode !== "bilingual") {
      const projection = plugin.fileWrites.findLast((item) =>
        item.filePath.startsWith("@data/"),
      );
      assert.match(
        projection.content,
        mode === "source" ? /修正テスト/ : /修改测试/,
      );
    }
    await plugin.sidebarHandlers.get("closeSubtitleEditor")();
    await tick();
    assert.equal(
      plugin.mpvCommands.filter((item) => item.name === "sub-reload").length,
      1,
    );
  });
}
