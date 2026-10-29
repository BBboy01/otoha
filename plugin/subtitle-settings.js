const { defaultLanguage } = require("./controller.js");

function languagePair(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const sourceLanguage = typeof value.sourceLanguage === "string" ? defaultLanguage(value.sourceLanguage) : "";
  const targetLanguage = typeof value.targetLanguage === "string" ? defaultLanguage(value.targetLanguage) : "";
  return sourceLanguage && targetLanguage && sourceLanguage !== targetLanguage
    ? { sourceLanguage, targetLanguage }
    : {};
}

function subtitleLanguages(filePath) {
  if (typeof filePath !== "string") return {};
  const match = filePath.split("/").pop().match(/ \[([^\[\]]+) to ([^\[\]]+)\]\.ass$/i);
  return match ? languagePair({ sourceLanguage: match[1], targetLanguage: match[2] }) : {};
}

function absolutePath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.includes("\0");
}

const DISPLAY_MODES = new Set(["source", "translation", "bilingual"]);

function displayMode(value) {
  return DISPLAY_MODES.has(value) ? value : "bilingual";
}

function createSubtitleSettings(preferences) {
  function read() {
    try {
      const value = JSON.parse(preferences.get("video_settings") || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function record(settings, mediaPath) {
    const value = absolutePath(mediaPath) ? settings[mediaPath] : null;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function update(mediaPath, values) {
    const settings = read();
    settings[mediaPath] = { ...record(settings, mediaPath), ...values };
    preferences.set("video_settings", JSON.stringify(settings));
    preferences.sync();
  }

  return {
    languages(mediaPath, preferredLocalizations, files = []) {
      const saved = languagePair(record(read(), mediaPath));
      if (saved.sourceLanguage) return saved;
      for (const file of Array.isArray(files) ? files : []) {
        const restored = subtitleLanguages(file && file.path);
        if (restored.sourceLanguage) return restored;
      }
      return {
        sourceLanguage: defaultLanguage(preferences.get("default_source_language")) || "en",
        targetLanguage: defaultLanguage(preferences.get("default_target_language")) || defaultLanguage(preferredLocalizations),
      };
    },

    rememberGeneration(mediaPath, languages, subtitlePath) {
      const pair = languagePair(languages);
      if (!absolutePath(mediaPath) || !pair.sourceLanguage || !absolutePath(subtitlePath) || !/\.ass$/i.test(subtitlePath)) return;
      update(mediaPath, { ...pair, subtitlePath });
    },

    rememberSelection(mediaPath, subtitlePath) {
      if (!absolutePath(mediaPath) || !absolutePath(subtitlePath) || !/\.ass$/i.test(subtitlePath)) return;
      update(mediaPath, { subtitlePath });
    },

    selectedSubtitle(mediaPath, files) {
      const available = (Array.isArray(files) ? files : []).filter((file) => file && absolutePath(file.path));
      const savedPath = record(read(), mediaPath).subtitlePath;
      return available.find((file) => file.path === savedPath) || available[0] || null;
    },

    displayMode(mediaPath) {
      return displayMode(record(read(), mediaPath).displayMode);
    },

    rememberDisplayMode(mediaPath, value) {
      if (!absolutePath(mediaPath) || !DISPLAY_MODES.has(value)) return;
      update(mediaPath, { displayMode: value });
    },
  };
}

module.exports = { createSubtitleSettings, subtitleLanguages };
