(function (root) {
  const defaults = { font: "Arial", scale: 1, color: "#FFFFFF", background: false, dimSource: true };
  function normalizeStyle(value = {}) {
    const font = typeof value.font === "string" ? value.font.trim() : "";
    const scale = Number(value.scale);
    return {
      font: font && [...font].length <= 128 && !/[,\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(font) ? font : defaults.font,
      scale: Number.isFinite(scale) ? Math.max(0.5, Math.min(3, scale)) : 1,
      color: typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color.toUpperCase() : defaults.color,
      background: value.background === true,
      dimSource: value.dimSource !== false,
    };
  }
  function readStyle(preferences) {
    try {
      const value = JSON.parse(preferences.get("subtitle_style") || "null");
      if (value && typeof value === "object" && !Array.isArray(value)) return normalizeStyle(value);
    } catch {}
    return normalizeStyle({font: preferences.get("subtitle_font"), scale: Number(preferences.get("subtitle_scale") || 100) / 100});
  }
  const api = { defaults, normalizeStyle, readStyle };
  if (typeof module !== "undefined") module.exports = api;
  else root.OtohaSubtitleStyle = api;
})(typeof window !== "undefined" ? window : this);
