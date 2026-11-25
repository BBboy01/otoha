const {
  audioTracks,
  createJsonLineParser,
  localMedia,
  phaseLabel,
  PROTOCOL_VERSION,
  resolveFFmpegPath,
  resolveAudioStreamIndex,
} = require("./controller.js");
const {
  prepareGeneration,
  executeGeneration,
  cancelGeneration,
} = require("./subtitle-generation.js");
const { subtitleLanguages } = require("./subtitle-settings.js");
const { idleJob } = require("./runtime-state.js");

function createGenerationWorkflow({
  jobController,
  runtimeStore,
  languagePreflightClient,
  subtitleSettings,
  subtitleLibraryClient,
  preferences,
  utils,
  mpv,
  hostConsole,
  getContext,
  getRequestSettings,
  operations,
  jobState,
  replaceJob,
  publishJob,
  sendState,
  playback,
  now = Date.now,
}) {
  let pendingAutoLoad = null;
  const currentJob = () => jobController.current();
  function isCurrent(job) {
    const context = getContext();
    return (
      runtimeStore.isCurrent(job.mediaOperation) &&
      job.fileLoadedSequence === context.fileLoadedSequence &&
      (!context.mediaPath || context.mediaPath === job.mediaPath)
    );
  }

  function fail(message, errorCode = "helper.unknown") {
    const runningJob = currentJob();
    if (runningJob) jobController.markTerminal();
    replaceJob({
      ...idleJob(),
      jobId: runningJob ? runningJob.id : null,
      status: "error",
      message,
      path: playback.currentPath(),
      errorCode,
    });
    publishJob();
  }

  function handleEvent(helperEvent) {
    const runningJob = currentJob();
    if (
      !runningJob ||
      runningJob.terminal ||
      (helperEvent.jobId !== runningJob.id &&
        !(helperEvent.type === "error" && helperEvent.jobId === "unknown"))
    )
      return;
    if (!isCurrent(runningJob) && helperEvent.type !== "completed") {
      if (["error", "cancelled"].includes(helperEvent.type)) {
        jobController.markTerminal();
        replaceJob(idleJob());
        publishJob();
      }
      return;
    }
    if (helperEvent.type === "phase") {
      if (runningJob.cancelRequested) return;
      replaceJob({
        ...jobState(),
        phase: helperEvent.phase || "",
        message: helperEvent.message || phaseLabel(helperEvent.phase),
        progress: Number.isFinite(helperEvent.progress)
          ? helperEvent.progress
          : null,
      });
      publishJob();
    } else if (helperEvent.type === "completed") {
      jobController.markTerminal();
      subtitleSettings.rememberGeneration(
        runningJob.mediaPath,
        runningJob.languages,
        helperEvent.path,
      );
      if (
        runtimeStore.getState().subtitleLibrary.mediaPath ===
        runningJob.mediaPath
      ) {
        subtitleLibraryClient.addFile({
          path: helperEvent.path,
          ...runningJob.languages,
          ...subtitleLanguages(helperEvent.path),
        });
      }
      const current = isCurrent(runningJob);
      replaceJob(
        {
          ...idleJob(),
          jobId: runningJob.id,
          status: "completed",
          path: helperEvent.path,
          message: current
            ? "字幕已生成"
            : "字幕已保存；当前视频已更换，因此未自动加载。",
        },
        { finish: !current },
      );
      if (current)
        jobController.setCompletion(
          playback.load(helperEvent.path, runningJob.mediaPath),
        );
      else publishJob();
    } else if (helperEvent.type === "cancelled") {
      jobController.markTerminal();
      replaceJob({
        ...idleJob(),
        jobId: runningJob.id,
        status: "cancelled",
        message: "已取消",
        errorCode: "job.cancelled",
      });
      publishJob();
    } else if (helperEvent.type === "error") {
      fail(
        helperEvent.message || "字幕生成失败。",
        helperEvent.code || "helper.unknown",
      );
    }
  }

  async function start(payload = {}, mediaOverride = null) {
    if (!operations().generate) return;
    runtimeStore.begin("display");
    const initial = getContext();
    let jobId = null;
    try {
      if (!initial.helperPath)
        throw new Error("Otoha 侧栏尚未完成初始化，请重新打开侧栏。");
      const media = mediaOverride || localMedia(initial.mediaURL);
      const tracks = audioTracks(mpv.getNative("track-list") || []);
      const { generationMode, streamIndex, sourceLanguage, targetLanguage } =
        prepareGeneration(payload, tracks, resolveAudioStreamIndex);
      jobId = `${now()}-${Math.random().toString(36).slice(2)}`;
      const cancelPath = utils.resolvePath(`@tmp/otoha-${jobId}.cancel`);
      if (!cancelPath) throw new Error("无法创建字幕任务取消标记。");
      const claimedJob = jobController.begin({
        id: jobId,
        cancelPath,
        mediaPath: media.path,
        languages: { sourceLanguage, targetLanguage },
        fileLoadedSequence: initial.fileLoadedSequence,
        mediaOperation: initial.mediaOperation,
        deferStart: payload.waitForProgress === true,
      });
      if (!claimedJob) return;
      replaceJob({
        ...idleJob(),
        jobId,
        status: "running",
        phase: "checkingEnvironment",
        message: "正在启动",
      });
      sendState(mediaOverride ? media.path : undefined);
      if (claimedJob.presentation && !(await claimedJob.presentation)) {
        throw Object.assign(
          new Error("无法显示生成进度，请重新打开侧栏后重试。"),
          { code: "ui.progressUnavailable" },
        );
      }
      await languagePreflightClient.check({
        sourceLanguage,
        targetLanguage,
        generationMode,
        mediaPath: media.path,
      });
      const check = languagePreflightClient.getState();
      if (check.status !== "ready")
        throw Object.assign(new Error(check.message || "请重试语言检查。"), {
          code: check.errorCode,
        });
      const ffmpegPath =
        generationMode === "translate"
          ? ""
          : await resolveFFmpegPath(preferences, (...args) =>
              utils.exec(...args),
            );
      if (
        claimedJob.cancelRequested ||
        !isCurrent(claimedJob) ||
        getContext().mediaPath !== media.path
      ) {
        jobController.markTerminal();
        replaceJob({
          ...jobState(),
          status: "cancelled",
          phase: "",
          message: "已取消",
          progress: null,
          path: null,
          loaded: false,
          errorCode: "job.cancelled",
        });
        publishJob();
        return;
      }
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        jobId,
        backend: "apple",
        generationMode,
        forceTranscription: payload.forceTranscription === true,
        inputSubtitlePath: payload.inputSubtitlePath || null,
        mediaPath: media.path,
        ffmpegPath,
        audioStreamIndex: streamIndex,
        sourceLanguage,
        targetLanguage,
        ...getRequestSettings(),
        cancellationFilePath: cancelPath,
      };
      const { result, stderr } = await executeGeneration({
        utils,
        helperPath: initial.helperPath,
        request,
        createJsonLineParser,
        claimedJob,
        onEvent: handleEvent,
        onParseError: (error) =>
          hostConsole.error(`Otoha: 忽略无效 helper 事件：${error.message}`),
      });
      if (!claimedJob.terminal)
        fail(
          result.status !== 0
            ? stderr.trim() || `字幕 helper 退出，状态码 ${result.status}。`
            : "字幕 helper 已退出，但没有返回完成事件。",
        );
    } catch (error) {
      if (currentJob() && !runtimeStore.isCurrent(currentJob().mediaOperation))
        replaceJob(idleJob());
      else if (currentJob()?.cancelRequested) {
        replaceJob({
          ...jobState(),
          status: "cancelled",
          message: "已取消",
          phase: "",
          progress: null,
          errorCode: "job.cancelled",
        });
        publishJob();
      } else fail(error.message || String(error), error.code);
    } finally {
      const runningJob = currentJob();
      if (runningJob && runningJob.id === jobId && runningJob.cancelPath) {
        await utils
          .exec("/bin/rm", ["-f", runningJob.cancelPath])
          .catch(() => {});
      }
      if (runningJob && runningJob.id === jobId && pendingAutoLoad) {
        const deferred = pendingAutoLoad;
        pendingAutoLoad = null;
        if (getContext().mediaPath === deferred.mediaPath)
          await playback.load(deferred.path);
      }
      jobController.reset();
      sendState(mediaOverride ? mediaOverride.path : undefined);
    }
  }

  return {
    start,
    fail,
    cancel: () =>
      cancelGeneration({
        jobController,
        replaceJob,
        jobState,
        utils,
        send: publishJob,
        onError: fail,
      }),
    deferAutoLoad: (path, mediaPath) => {
      pendingAutoLoad = { path, mediaPath };
    },
  };
}

module.exports = { createGenerationWorkflow };
