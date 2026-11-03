function createIinaAdapter(runtime) {
  if (!runtime || typeof runtime !== "object") throw new TypeError("IINA runtime is required");
  const { console: hostConsole, core, event, file, menu, mpv, preferences, sidebar, utils } = runtime;

  return Object.freeze({
    core,
    console: hostConsole,
    event,
    file,
    menu,
    mpv,
    preferences,
    sidebar,
    utils,
    mediaURL() {
      return core && core.status ? core.status.url || "" : "";
    },
    playerWindowIsLoaded() {
      return !core || !core.window || core.window.loaded === true;
    },
    trackList() {
      return mpv.getNative("track-list") || [];
    },
    videoDimensions() {
      const displayWidth = Number(mpv.getNumber("dwidth"));
      const displayHeight = Number(mpv.getNumber("dheight"));
      const hasDisplayDimensions = Number.isInteger(displayWidth) && displayWidth > 0
        && Number.isInteger(displayHeight) && displayHeight > 0;
      let width = hasDisplayDimensions ? displayWidth : Number(core.status && core.status.videoWidth);
      let height = hasDisplayDimensions ? displayHeight : Number(core.status && core.status.videoHeight);
      const videoRotation = Number(mpv.getNumber("video-params/rotate")) || 0;
      const userRotation = Number(mpv.getNumber("video-rotate")) || 0;
      const netRotation = ((videoRotation - userRotation) % 360 + 360) % 360;
      if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 && (netRotation === 90 || netRotation === 270)) {
        [width, height] = [height, width];
      }
      return {
        videoWidth: Number.isInteger(width) && width > 0 ? width : null,
        videoHeight: Number.isInteger(height) && height > 0 ? height : null,
      };
    },
    preference(key) {
      return preferences.get(key);
    },
    loadSidebar(filePath) {
      return sidebar.loadFile(filePath);
    },
    postSidebar(name, payload) {
      return sidebar.postMessage(name, payload);
    },
    onSidebarMessage(name, handler) {
      return sidebar.onMessage(name, handler);
    },
    exec(...args) {
      return utils.exec(...args);
    },
  });
}

module.exports = { createIinaAdapter };
