const SETTING_SCHEMA = Object.freeze({
  ffmpeg_path: { defaultValue: "", normalize: normalizeString },
  output_directory: { defaultValue: "", normalize: normalizeString },
  auto_load: { defaultValue: false, normalize: normalizeBoolean },
  subtitle_scale: { defaultValue: 100, normalize: normalizeScale },
  subtitle_font: { defaultValue: "Arial", normalize: normalizeFont },
  default_source_language: { defaultValue: "en", normalize: normalizeString },
  default_target_language: { defaultValue: "", normalize: normalizeString },
});

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBoolean(value) {
  return [true, 1, "true"].includes(value);
}

function normalizeFont(value) {
  const name = normalizeString(value);
  return name && [...name].length <= 128 && !/[,\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(name) ? name : "Arial";
}

function normalizeScale(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 100;
  return Math.min(300, Math.max(50, numeric));
}

function definitionFor(key) {
  return SETTING_SCHEMA[key] || null;
}

function readSetting(preferences, key) {
  const definition = definitionFor(key);
  if (!definition) return undefined;
  const value = preferences.get(key);
  return value === undefined || value === null || value === ""
    ? definition.defaultValue
    : definition.normalize(value);
}

function writeSetting(preferences, key, value) {
  const definition = definitionFor(key);
  if (!definition) return false;
  preferences.set(key, definition.normalize(value));
  preferences.sync();
  return true;
}

module.exports = { SETTING_SCHEMA, readSetting, writeSetting };
