const EMPTY_LIBRARY = Object.freeze({
  mediaPath: null,
  outputDirectoryPath: null,
  rootDirectoryPath: "",
  files: [],
  loading: false,
});

function createSubtitleLibraryClient({
  exec,
  mediaPathForURL,
  subtitleLanguages,
  beginOperation,
  isCurrentOperation,
  isAutoLoadEnabled,
  onMediaChanged,
  onStateChanged,
  onUpdated,
  onAutoLoad,
  onError,
}) {
  let library = { ...EMPTY_LIBRARY, files: [] };

  function state() {
    return library;
  }

  function replace(next) {
    library = { ...next, files: Array.isArray(next.files) ? next.files : [] };
    if (typeof onStateChanged === "function") onStateChanged(library);
    return library;
  }

  function invalidate() {
    beginOperation();
    replace({ ...library, outputDirectoryPath: null, loading: false });
  }

  function clear() {
    const hadMedia = library.mediaPath !== null;
    beginOperation();
    replace(EMPTY_LIBRARY);
    if (hadMedia && typeof onMediaChanged === "function") onMediaChanged();
  }

  function addFile(file) {
    if (!file || typeof file.path !== "string") return;
    const files = [file, ...library.files.filter((item) => item.path !== file.path)];
    replace({ ...library, files });
  }

  function update({ helperPath, media, mediaURLOverride = null, outputDirectoryPath = "", force = false }) {
    if (!media) {
      clear();
      return;
    }
    if (!helperPath) return;
    if (!force && library.mediaPath === media.path && library.outputDirectoryPath === outputDirectoryPath) return;

    const operation = beginOperation();
    const mediaChanged = library.mediaPath !== null && library.mediaPath !== media.path;
    if (mediaChanged && typeof onMediaChanged === "function") onMediaChanged();
    const previousFiles = library.mediaPath === media.path ? library.files : [];
    const previousRootDirectoryPath = library.mediaPath === media.path ? library.rootDirectoryPath : "";
    replace({
      mediaPath: media.path,
      outputDirectoryPath,
      rootDirectoryPath: previousRootDirectoryPath,
      files: previousFiles,
      loading: true,
    });
    const request = { mediaPath: media.path, outputDirectoryPath };

    return exec(helperPath, ["--list-subtitles-json", JSON.stringify(request)])
      .then((result) => {
        if (!isCurrentOperation(operation)) return;
        if (!result || result.status !== 0) throw new Error("字幕库读取失败");
        const listing = JSON.parse(String(result.stdout || "{}"));
        const files = Array.isArray(listing.files)
          ? listing.files
            .filter((item) => item && typeof item.path === "string" && item.path.startsWith("/") && item.path.toLowerCase().endsWith(".ass"))
            .map((item) => ({ ...item, ...subtitleLanguages(item.path) }))
          : [];
        const currentMediaPath = mediaPathForURL(mediaURLOverride);
        if (currentMediaPath && currentMediaPath !== media.path) return;

        replace({
          mediaPath: media.path,
          outputDirectoryPath,
          rootDirectoryPath: typeof listing.rootDirectoryPath === "string" ? listing.rootDirectoryPath : "",
          files,
          loading: false,
        });
        if (files.length > 0 && isAutoLoadEnabled()) onAutoLoad(files, mediaURLOverride ? media.path : null);
        if (typeof onUpdated === "function") onUpdated(mediaURLOverride);
      })
      .catch((error) => {
        if (!isCurrentOperation(operation)) return;
        replace({
          mediaPath: media.path,
          outputDirectoryPath,
          rootDirectoryPath: previousRootDirectoryPath,
          files: previousFiles,
          loading: false,
        });
        onError({ mediaChanged, previousFiles, error });
      });
  }

  return { addFile, clear, invalidate, state, update };
}

module.exports = { createSubtitleLibraryClient };
