const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlugin, helperPath } = require("./main-fixture.js");

test("generation uses default, legacy and rich style preferences", async () => {
  for (const [savedPreferences, font, scale, rich] of [
    [{}, "Arial", 1, null],
    [{subtitle_font: "PingFang SC", subtitle_scale: 120}, "PingFang SC", 1.2, null],
    [{subtitle_style: JSON.stringify({font: "Menlo", scale: 1.4, color: "#FFE066", background: true})}, "Menlo", 1.4, "#FFE066"],
  ]) {
    const plugin = createPlugin({savedPreferences, helperTerminal: "error"});
    plugin.runSidebarLoad();
    plugin.sidebarHandlers.get("ready")({helperPath});
    await plugin.sidebarHandlers.get("start")({trackId: 7, sourceLanguage: "ja", targetLanguage: "zh-Hans"});
    const call = plugin.execCalls.find(item => item.file === helperPath && item.args[0] === "--request-json");
    const request = JSON.parse(call.args[1]);
    assert.equal(request.subtitleFont, font);
    assert.equal(request.subtitleScale, scale);
    if (rich) assert.equal(request.subtitleStyle.color, rich);
    else assert.equal(request.subtitleStyle, null);
  }
});
