const { readSetting, writeSetting } = require("./settings-schema.js");

function createSettingsController({ preferences, exec, invalidateLibrary, reportError }) {
  function autoLoadEnabled() {
    return readSetting(preferences, "auto_load");
  }

  async function reveal(filePath) {
    if (!filePath) return;
    try {
      const result = await exec("/usr/bin/open", ["-R", filePath]);
      if (result && result.status !== 0) throw new Error(result.stderr || `Finder 退出状态码 ${result.status}。`);
    } catch (error) {
      reportError(`无法在 Finder 中显示字幕：${error.message || error}`);
    }
  }

  async function setSetting(key, value) {
    if (!writeSetting(preferences, key, value)) return;
    if (key === "output_directory" || key === "auto_load") invalidateLibrary();
  }

  return { autoLoadEnabled, reveal, setSetting };
}

module.exports = { createSettingsController };
