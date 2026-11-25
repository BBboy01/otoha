const { waitForSubtitleTrack } = require("./controller.js");
const { normalizeDisplayMode } = require("./subtitle-display.js");
const { idleJob } = require("./runtime-state.js");

function createSubtitlePlayback({
  core,
  mpv,
  runtimeStore,
  jobController,
  subtitleSettings,
  subtitleTrackManager,
  getContext,
  mediaPathForURL,
  operations,
  publishJob,
  sendState,
  now = Date.now,
  schedule = setTimeout,
}) {
  let outputPath = null;
  const state = () => runtimeStore.getState().subtitleLoad;
  function replace(next) {
    runtimeStore.setState((current) => ({
      ...current,
      subtitleLoad: jobController.withTiming(next),
      feedbackSource: "load",
    }));
  }

  async function load(
    filePath,
    mediaURLOverride = null,
    rememberSelection = false,
    forceReload = false,
  ) {
    if (!filePath) return;
    const initial = getContext();
    const mediaPath = mediaPathForURL(mediaURLOverride || initial.mediaURL);
    const displayOperation = runtimeStore.begin("display");
    const displayMode = subtitleSettings.displayMode(mediaPath);
    const isCurrent = () => {
      const current = getContext();
      return (
        runtimeStore.isCurrent(initial.mediaOperation) &&
        runtimeStore.isCurrent(displayOperation) &&
        initial.fileLoadedSequence === current.fileLoadedSequence &&
        current.mediaPath === mediaPath
      );
    };
    const runningJob = jobController.current();
    outputPath = filePath;
    replace({
      ...idleJob(),
      jobId: runningJob ? runningJob.id : null,
      status: "loading",
      phase: "loading",
      message: "正在加载字幕",
      path: filePath,
    });
    publishJob();
    try {
      const loadedPath = await subtitleTrackManager.prepare(
        filePath,
        mediaPath,
        displayMode,
      );
      if (!isCurrent()) return;
      const existing = subtitleTrackManager.find(loadedPath);
      if (forceReload && existing)
        mpv.command("sub-reload", [String(existing.id)]);
      else await core.subtitle.loadTrack(loadedPath);
      await waitForSubtitleTrack(mpv, loadedPath, now, schedule);
      if (!isCurrent()) return;
      const loadedTrack = subtitleTrackManager.find(loadedPath);
      if (loadedTrack && core.subtitle) core.subtitle.id = loadedTrack.id;
      subtitleTrackManager.removePrevious(loadedPath);
      if (rememberSelection)
        subtitleSettings.rememberSelection(mediaPath, filePath);
      replace({
        ...state(),
        status: "completed",
        phase: "",
        message: "字幕已加载",
        loaded: true,
        displayMode,
      });
    } catch (error) {
      if (!isCurrent()) return;
      replace({
        ...state(),
        status: "load-error",
        phase: "",
        message: `字幕已生成，但 IINA 加载失败：${error.message || error}`,
        loaded: false,
        errorCode: "subtitle.loadFailed",
      });
    }
    publishJob();
    sendState(mediaURLOverride);
  }

  function reset() {
    outputPath = null;
    runtimeStore.setState((current) => ({
      ...current,
      subtitleLoad: idleJob(),
    }));
  }

  return {
    load,
    reset,
    currentPath: () => outputPath,
    clear(path) {
      if (outputPath !== path) return false;
      runtimeStore.begin("display");
      subtitleTrackManager.unload();
      reset();
      return true;
    },
    setDisplayMode(value) {
      if (!operations().display) return;
      const mode = normalizeDisplayMode(value);
      const { mediaPath } = getContext();
      if (!mediaPath) return;
      subtitleSettings.rememberDisplayMode(mediaPath, mode);
      const selected = subtitleSettings.selectedSubtitle(
        mediaPath,
        runtimeStore.getState().subtitleLibrary.files,
      );
      if (selected) return load(selected.path);
      sendState();
    },
  };
}

module.exports = { createSubtitlePlayback };
