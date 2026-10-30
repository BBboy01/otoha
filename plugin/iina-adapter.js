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
