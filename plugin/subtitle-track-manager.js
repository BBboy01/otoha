function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createSubtitleTrackManager({ mpv, file, resolvePath, mediaPathForURL, renderSubtitleMode }) {
  let activeDisplayTrackPath = null;

  function find(filePath) {
    return (mpv.getNative("track-list") || []).find((track) => {
      if (!track || track.type !== "sub") return false;
      const externalPath = track["external-filename"] || track.externalFilename;
      return typeof externalPath === "string" && mediaPathForURL(externalPath) === mediaPathForURL(filePath);
    });
  }

  function prepare(filePath, mediaPath, mode) {
    if (mode === "bilingual") return filePath;
    const content = file.read(filePath);
    const rendered = renderSubtitleMode(content, mode);
    const pseudoPath = `@data/otoha-display-${stableHash(mediaPath)}-${mode}.ass`;
    file.write(pseudoPath, rendered);
    const resolvedPath = resolvePath(pseudoPath);
    if (!resolvedPath) throw new Error("无法定位字幕显示缓存。");
    return resolvedPath;
  }

  function rememberLoaded(filePath) {
    activeDisplayTrackPath = filePath;
  }

  function removePrevious(keepPath) {
    const previousPath = activeDisplayTrackPath;
    activeDisplayTrackPath = keepPath;
    if (!previousPath || previousPath === keepPath) return;
    const previousTrack = find(previousPath);
    if (previousTrack) mpv.command("sub-remove", [String(previousTrack.id)]);
  }

  function reset() {
    activeDisplayTrackPath = null;
  }

  return { find, prepare, rememberLoaded, removePrevious, reset };
}

module.exports = { createSubtitleTrackManager };
