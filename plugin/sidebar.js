const { elements, LANGUAGES, fillLanguages, trackLabel } =
  window.sidebarRenderer;
let state = null;
let selectedTrackId = null;
let selectedSourceLanguage = "";
let selectedTargetLanguage = "";
let generationMode = "bilingual";
let generationSource = "audio";
let transcriptionStrategy = "reuse";
let selectedSubtitlePath = "";
let currentMediaPath = "";
let lastFeedbackKey = "";
let languageValidationRequested = false;
let exporting = false;
let lastExportedPath = "";
const progressFeedback = window.createProgressFeedback(
  elements,
  () => currentMediaPath,
  (jobId) => post("progressReady", { jobId }),
);
const requestPreflight = window.createSidebarPreflight(post);
function deriveState(previous = state || {}) {
  return window.sidebarState.deriveSidebarState(
    state,
    {
      trackId: selectedTrackId,
      sourceLanguage: selectedSourceLanguage,
      targetLanguage: selectedTargetLanguage,
      subtitlePath: selectedSubtitlePath,
      generationMode,
      generationSource,
    },
    previous,
  );
}
const generationControls = window.createGenerationControls?.({
  post,
  getSelection: () => ({
    subtitlePath: selectedSubtitlePath,
    sourceLanguage: selectedSourceLanguage,
    targetLanguage: selectedTargetLanguage,
  }),
  onModeChanged: (mode) => {
    generationMode = mode;
    if (state) renderState(state);
  },
  onSourceChanged: (source) => {
    generationSource = source;
    if (state) renderState(state);
  },
  onStrategyChanged: (strategy) => {
    transcriptionStrategy = strategy;
  },
});
function post(name, payload) {
  iina.postMessage(name, payload);
}

function updateLanguageErrors() {
  if (!state) return;
  const { sourceError: sourceMessage, targetError: targetMessage } =
    deriveState();
  for (const [field, error, message] of [
    [elements.sourceLanguage, elements.sourceLanguageError, sourceMessage],
    [elements.targetLanguage, elements.targetLanguageError, targetMessage],
  ]) {
    field.setAttribute(
      "aria-invalid",
      String(languageValidationRequested && Boolean(message)),
    );
    error.textContent = languageValidationRequested ? message : "";
    error.hidden = !languageValidationRequested || !message;
  }
}

function renderState(nextState) {
  const focused = document.activeElement;
  window.subtitleEditorUI?.onState(nextState);
  window.subtitleAssociationUI?.onState(nextState);
  const previous = state || {};
  state = nextState;
  const view = deriveState(previous);
  selectedTrackId = view.trackId;
  selectedSourceLanguage = view.sourceLanguage;
  selectedTargetLanguage = view.targetLanguage;
  selectedSubtitlePath = view.subtitlePath;
  currentMediaPath = state.media ? state.media.path : "";
  const mediaName = state.media
    ? state.title || state.media.name
    : state.title || "未打开视频";
  elements.mediaName.textContent = mediaName;
  elements.mediaName.title = mediaName;
  elements.mediaName.setAttribute("aria-label", mediaName);
  elements.mediaError.textContent =
    state.mediaError ||
    (state.title && !state.media ? "仅支持本地文件视频。" : "");
  const libraryError = state.subtitleLibraryError?.message || "";
  if (elements.subtitleLibraryError.textContent !== libraryError)
    elements.subtitleLibraryError.textContent = libraryError;
  elements.subtitleLibraryError.hidden = !libraryError;

  const audioTracks = view.tracks;
  window.updateSidebarOptions(
    elements.audioTrack,
    audioTracks.length
      ? audioTracks.map((track) => ({
          label: trackLabel(track),
          value: String(track.id),
          disabled: !track.available,
        }))
      : [{ label: "没有音轨", value: "" }],
    selectedTrackId == null ? "" : String(selectedTrackId),
  );
  if (view.mediaChanged) {
    languageValidationRequested = false;
    lastExportedPath = "";
    exporting = false;
    elements.exportResult.hidden = true;
    elements.revealExport.hidden = true;
  }
  fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
  fillLanguages(elements.targetLanguage, selectedTargetLanguage);

  const busy = !view.capabilities.configure;
  const checkingSubtitles = view.checkingSubtitles;
  elements.audioTrack.disabled =
    !state.media ||
    audioTracks.length === 0 ||
    busy ||
    generationSource === "existing-subtitle";
  elements.sourceLanguage.disabled =
    busy || generationSource === "existing-subtitle";
  elements.targetLanguage.disabled =
    busy || (generationMode === "source" && generationSource === "audio");
  elements.targetLanguage.required = view.needsTarget;
  const subtitles = view.subtitles;
  elements.existingSubtitles.hidden = subtitles.length === 0;
  elements.reveal.hidden = subtitles.length === 0;
  elements.reveal.disabled = busy;
  document.querySelector("#delete-button").disabled =
    busy || checkingSubtitles || subtitles.length === 0;
  elements.editSubtitle.disabled = busy || subtitles.length === 0;
  window.updateSidebarOptions(
    elements.subtitleChoice,
    subtitles.map((subtitle) => {
      const path = subtitle.path;
      const name =
        typeof path === "string" ? path.split("/").pop() : "字幕文件";
      const label =
        (generationSource === "existing-subtitle"
          ? name
          : window.sidebarWorkflow?.subtitleLabel(subtitle, LANGUAGES)) ||
        name ||
        "字幕文件";
      return { label, value: path };
    }),
    selectedSubtitlePath,
  );
  const selectedSubtitle = view.subtitle;
  const sourceOnly = view.sourceOnly;
  const displayMode = sourceOnly ? "source" : state.displayMode || "bilingual";
  for (const radio of elements.displayModes) {
    radio.checked = radio.value === displayMode;
    radio.disabled =
      !state.media || busy || (sourceOnly && radio.value !== "source");
  }
  elements.displayMode?.setAttribute?.("data-selected", displayMode);
  if (elements.subtitleVersion) {
    const subtitleVersion =
      window.sidebarWorkflow?.subtitleVersion(selectedSubtitle) || "";
    elements.subtitleVersion.textContent = subtitleVersion;
    elements.subtitleVersion.hidden = !subtitleVersion;
  }
  elements.subtitleChoice.disabled = subtitles.length === 0 || busy;
  for (const radio of elements.exportModes) {
    radio.disabled =
      subtitles.length === 0 ||
      busy ||
      exporting ||
      (sourceOnly && radio.value !== "source");
    if (sourceOnly) radio.checked = radio.value === "source";
  }
  elements.exportButton.disabled =
    !state.media ||
    subtitles.length === 0 ||
    busy ||
    checkingSubtitles ||
    exporting;
  elements.reveal.setAttribute(
    "aria-label",
    selectedSubtitlePath
      ? `在 Finder 中显示 ${selectedSubtitlePath.split("/").pop()}`
      : "在 Finder 中显示所选字幕",
  );
  updateLanguageErrors();
  updateGeneration();
  renderJob(
    state.subtitleLibraryError && state.job?.errorCode === "subtitle.libraryFailed"
      ? { status: "idle", message: "" }
      : checkingSubtitles && (!state.job || state.job.status === "idle")
      ? { status: "checking", message: "正在检查字幕列表" }
      : state.job,
  );
  restoreJobFocus(focused);
  window.sidebarWorkflow?.onState(state);
  window.sidebarSelects?.refresh();
}
function restoreJobFocus(focused) {
  if (![elements.cancel, elements.jobMessage].includes(focused)) return;
  if (
    focused === elements.cancel &&
    !elements.cancel.hidden &&
    !elements.cancel.disabled
  )
    return;
  const target =
    !elements.start.disabled &&
    elements.start.closest?.("details")?.open !== false
      ? elements.start
      : !elements.jobStatus.hidden
        ? elements.jobMessage
        : null;
  if (!target || target === focused) return;
  if (target === elements.jobMessage) target.tabIndex = -1;
  target.focus();
}
function updateGeneration(force = false) {
  if (!state) return;
  const view = deriveState();
  const busy = !view.capabilities.generate;
  generationControls?.update({
    busy,
    state,
    sourceMode: generationSource,
    selectedSubtitlePath,
    sourceLanguage: selectedSourceLanguage,
    targetLanguage: selectedTargetLanguage,
  });
  elements.start.disabled = !view.canGenerate;
  elements.start.textContent = view.startLabel;
  elements.start.setAttribute(
    "aria-label",
    busy ? "正在生成" : elements.start.textContent,
  );
  renderLanguagePreflight(view, force);
  if (view.preflight.valid)
    window.sidebarWorkflow?.onPreflight(
      force ? null : view.preflight.check || null,
    );
  requestPreflight(view, force);
}
function renderLanguagePreflight(view, force) {
  const { valid } = view.preflight;
  elements.languageResourceStatus.hidden = !valid;
  elements.checkLanguages.disabled = !view.capabilities.preflight;
  if (!valid) return;
  const check = force ? null : view.preflight.check;
  const matches = Boolean(check);
  const status = matches ? check.status : "checking";
  elements.languageResourceMessage.textContent = matches
    ? check.message || "正在检查语言资源"
    : "正在检查语言资源";
  elements.languageResourceStatus.setAttribute(
    "aria-busy",
    String(status === "checking"),
  );
  elements.checkLanguages.hidden = status === "checking";
  elements.start.disabled =
    elements.start.disabled || !matches || status !== "ready";
}
function renderJob(job) {
  const current = job || { status: "idle", message: "" };
  progressFeedback.render(current);
  const message = current.message || "";
  const failed = ["error", "load-error"].includes(current.status);
  const noSpeech = current.errorCode === "speech.noSpeech";
  const libraryWarning = current.errorCode === "subtitle.libraryFailed";
  const hasDetails = (failed || libraryWarning) && Boolean(message);
  const feedbackKey = JSON.stringify([
    currentMediaPath,
    current.status,
    current.errorCode,
    message,
  ]);
  if (feedbackKey !== lastFeedbackKey) {
    elements.jobDetailMessage.hidden = true;
    elements.jobDetailToggle.setAttribute("aria-expanded", "false");
    lastFeedbackKey = feedbackKey;
  }
  let summary = message;
  if (noSpeech) summary = "未识别到语音";
  else if (current.status === "load-error") summary = "字幕加载失败";
  else if (libraryWarning) summary = "字幕库读取失败";
  else if (failed) summary = "字幕生成失败";
  elements.jobMessage.textContent = summary;
  elements.jobStatus.hidden =
    progressFeedback.retracted ||
    current.status === "idle" ||
    (current.status === "available" && !libraryWarning) ||
    (current.status === "completed" && current.loaded && !current.jobId);
  if (current.status === "completed" && current.loaded)
    elements.jobMessage.textContent = current.jobId
      ? "字幕已生成并加载"
      : "字幕已加载";
  window.sidebarWorkflow?.onJob(current);
  elements.jobStatus.dataset.kind =
    noSpeech || libraryWarning
      ? "warning"
      : failed
        ? "error"
        : current.status === "completed" && current.loaded
          ? "success"
          : "info";
  elements.jobIcon.hidden = !failed && !libraryWarning;
  elements.jobDetailToggle.hidden = !hasDetails;
  elements.jobDetailMessage.textContent = hasDetails ? message : "";
  if (!hasDetails) elements.jobDetailMessage.hidden = true;
  const subtitles = (state && state.availableSubtitles) || [];
  elements.subtitleLoaded.hidden = !(
    current.status === "completed" &&
    current.loaded === true &&
    current.path === selectedSubtitlePath &&
    subtitles.some((subtitle) => subtitle.path === current.path)
  );
  elements.cancel.hidden = !["running", "canceling"].includes(current.status);
  elements.cancel.disabled = current.status === "canceling";
  elements.retry.hidden = current.status !== "load-error";
  elements.progress.hidden = elements.progressDrawer.hidden;
  elements.progress.setAttribute(
    "aria-label",
    current.phase === "translating" ? "翻译进度" : "字幕生成进度",
  );
  if (Number.isFinite(current.progress)) {
    const progress = Math.min(Math.max(current.progress, 0), 1);
    const percentage = Math.round(progress * 100);
    elements.progress.value = progress;
    elements.progress.setAttribute("aria-valuenow", String(progress));
    elements.progress.setAttribute("aria-valuetext", `${percentage}%`);
  } else {
    if (typeof elements.progress.removeAttribute === "function") {
      elements.progress.removeAttribute("value");
      elements.progress.removeAttribute("aria-valuenow");
      elements.progress.removeAttribute("aria-valuetext");
    }
  }
}
elements.jobDetailToggle.addEventListener("click", () => {
  elements.jobDetailMessage.hidden = !elements.jobDetailMessage.hidden;
  elements.jobDetailToggle.setAttribute(
    "aria-expanded",
    String(!elements.jobDetailMessage.hidden),
  );
});
elements.audioTrack.addEventListener("change", () => {
  selectedTrackId = elements.audioTrack.value;
  updateGeneration();
});
elements.sourceLanguage.addEventListener("change", () => {
  selectedSourceLanguage = elements.sourceLanguage.value;
  if (state) renderState(state);
});
elements.targetLanguage.addEventListener("change", () => {
  selectedTargetLanguage = elements.targetLanguage.value;
  if (state) renderState(state);
});
function setDisplayMode(mode) {
  const busy =
    state &&
    !window.subtitleOperationPolicy.operationCapabilities(state).display;
  if (
    !state ||
    !state.media ||
    busy ||
    !["source", "translation", "bilingual"].includes(mode)
  )
    return;
  post("setDisplayMode", mode);
}

for (const radio of elements.displayModes) {
  radio.addEventListener("change", () => setDisplayMode(radio.value));
}

elements.jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  languageValidationRequested = true;
  updateLanguageErrors();
  const needsTarget =
    generationSource === "existing-subtitle" || generationMode !== "source";
  if (!selectedSourceLanguage || (needsTarget && !selectedTargetLanguage)) {
    renderJob({ status: "validation", message: "请选择转录语言和翻译语言。" });
    return;
  }
  if (needsTarget && selectedSourceLanguage === selectedTargetLanguage) {
    renderJob({
      status: "validation",
      message: "请选择不同的转录语言和翻译语言。",
    });
    return;
  }
  if (elements.start.disabled) return;
  const payload =
    generationSource === "existing-subtitle"
      ? {
          waitForProgress: true,
          sourceLanguage: selectedSourceLanguage,
          targetLanguage: selectedTargetLanguage,
          generationMode: "translate",
          inputSubtitlePath: selectedSubtitlePath,
        }
      : {
          waitForProgress: true,
          trackId: selectedTrackId,
          sourceLanguage: selectedSourceLanguage,
          targetLanguage:
            generationMode === "source" ? "" : selectedTargetLanguage,
          generationMode,
          forceTranscription: transcriptionStrategy === "force",
        };
  const matching = (state.availableSubtitles || []).some(
    (subtitle) =>
      (generationSource === "audio" ||
        subtitle.path !== selectedSubtitlePath) &&
      subtitle.sourceLanguage === selectedSourceLanguage &&
      subtitle.targetLanguage === selectedTargetLanguage,
  );
  const start = () => post("start", payload);
  if (window.sidebarWorkflow)
    window.sidebarWorkflow.requestStart(payload, matching, start);
  else start();
});

elements.cancel.addEventListener("click", () => post("cancel"));
elements.checkLanguages.addEventListener("click", () => {
  updateGeneration(true);
});
elements.subtitleChoice.addEventListener("change", () => {
  selectedSubtitlePath = elements.subtitleChoice.value;
  if (state) renderState(state);
  post("loadExisting", selectedSubtitlePath);
});
elements.retry.addEventListener("click", () => post("retryLoad"));
elements.reveal.addEventListener("click", () =>
  post("reveal", elements.subtitleChoice.value),
);
elements.exportButton.addEventListener("click", () => {
  const selectedMode = Array.from(elements.exportModes).find(
    (radio) => radio.checked,
  );
  if (!selectedSubtitlePath || !selectedMode || elements.exportButton.disabled)
    return;
  post("exportSubtitle", {
    subtitlePath: selectedSubtitlePath,
    mode: selectedMode.value,
  });
});
elements.revealExport.addEventListener("click", () => {
  if (lastExportedPath) post("reveal", lastExportedPath);
});
elements.editSubtitle.addEventListener("click", () =>
  post("editSubtitle", elements.subtitleChoice.value),
);
iina.onMessage("state", renderState);
iina.onMessage("exportResult", (result) => {
  const current = result || {};
  exporting = current.status === "running";
  elements.exportResult.hidden = current.status === "cancelled";
  elements.exportResult.dataset.kind =
    current.status === "error" ? "error" : "info";
  if (current.status === "success") {
    lastExportedPath = current.path;
    elements.exportMessage.textContent = `已导出：${String(current.path || "")
      .split("/")
      .pop()}`;
    elements.revealExport.hidden = !lastExportedPath;
  } else if (current.status === "running") {
    elements.exportMessage.textContent = "正在导出 SRT…";
    elements.revealExport.hidden = true;
  } else if (current.status === "error") {
    elements.exportMessage.textContent = `导出失败：${current.message || "请重试。"}`;
    elements.revealExport.hidden = true;
  }
  if (state) renderState(state);
});
iina.onMessage("job", (job) => {
  if (state) {
    renderState({ ...state, job, hasOutput: Boolean(job.path || state.hasOutput) });
  } else {
    renderJob(job);
  }
});

const helperURL = new URL(
  "bin/OtohaHelper.app/Contents/MacOS/otoha-helper",
  window.location.href,
);
iina.postMessage("ready", {
  helperPath: decodeURIComponent(helperURL.pathname),
});
iina.postMessage("refresh");
window.setInterval(() => post("refresh"), 2500);
window.setInterval(() => progressFeedback.tick(), 1000);
