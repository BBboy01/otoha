const { readStyle } = require("./subtitle-style.js");
const { createSubtitleTrackManager } = require("./subtitle-track-manager.js");

function createSubtitleStyleRuntime({preferences, file, utils, event, getContext, reload}) {
  let sequence = 0;
  let applied = "";
  let refreshing = false;
  const getStyle = () => preferences.get("subtitle_style") ? readStyle(preferences) : null;

  async function renderStyle(content, style) {
    const { helperPath } = getContext();
    if (!helperPath) throw new Error("字幕工具尚未就绪，请重新打开侧栏。");
    const id = `${Date.now()}-${++sequence}`;
    const input = `@tmp/otoha-style-input-${id}.json`;
    const output = `@tmp/otoha-style-output-${id}.json`;
    try {
      file.write(input, JSON.stringify({content, style}));
      const inputPath = utils.resolvePath(input), outputPath = utils.resolvePath(output);
      if (!inputPath || !outputPath) throw new Error("无法创建字幕样式缓存。");
      const result = await utils.exec(helperPath, ["--style-subtitle-file", inputPath, outputPath]);
      if (!result || result.status !== 0) throw new Error(result?.stderr || "无法应用字幕样式。");
      return file.read(outputPath);
    } finally {
      for (const path of [input, output]) { try { file.delete(path); } catch {} }
    }
  }

  async function refresh() {
    const context = getContext();
    if (refreshing || context.busy || !context.path || !context.loaded || !getStyle()) return;
    const stamp = JSON.stringify([context.path, getStyle()]);
    if (stamp === applied) return;
    refreshing = true;
    try {
      await reload(context.path);
      const next = getContext();
      if (next.loaded && next.path === context.path && JSON.stringify([next.path, getStyle()]) === stamp) applied = stamp;
    } finally { refreshing = false; }
  }
  event.on("iina.window-main.changed", (main) => { if (main) refresh().catch(() => {}); });
  return {
    getStyle, renderStyle, refresh,
    generationSettings() {
      const style = readStyle(preferences);
      return {subtitleFont: style.font, subtitleScale: style.scale, subtitleStyle: getStyle()};
    },
  };
}

function createStyledSubtitleTrackManager(options) {
  const runtime = createSubtitleStyleRuntime(options);
  return {
    ...createSubtitleTrackManager({...options, resolvePath: path => options.utils.resolvePath(path),
      getStyle: runtime.getStyle, renderStyle: runtime.renderStyle}),
    generationSettings: runtime.generationSettings,
  };
}

module.exports = { createSubtitleStyleRuntime, createStyledSubtitleTrackManager };
