const LANGUAGES = [
  ["en", "English"],
  ["zh-Hans", "简体中文"],
  ["zh-Hant", "繁體中文"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["it", "Italiano"],
  ["pt-BR", "Português (Brasil)"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
];
const elements = {
  audioTrack: document.querySelector("#audio-track"),
  cancel: document.querySelector("#cancel-button"),
  displayMode: document.querySelector("#display-mode"),
  displayModes: document.querySelectorAll("input[name='display-mode']"),
  exportButton: document.querySelector("#export-button"),
  exportMessage: document.querySelector("#export-message"),
  exportResult: document.querySelector("#export-result"),
  exportModes: document.querySelectorAll("input[name='export-mode']"),
  existingSubtitles: document.querySelector("#existing-subtitles"),
  editSubtitle: document.querySelector("#edit-subtitle-button"),
  jobForm: document.querySelector("#job-form"),
  jobMessage: document.querySelector("#job-message"),
  jobAnnouncement: document.querySelector("#job-announcement"),
  jobElapsed: document.querySelector("#job-elapsed"),
  jobStatus: document.querySelector("#job-status"),
  jobIcon: document.querySelector("#job-icon"),
  jobDetailToggle: document.querySelector("#job-detail-toggle"),
  jobDetailMessage: document.querySelector("#job-detail-message"),
  progressDrawer: document.querySelector("#job-progress"),
  languageResourceStatus: document.querySelector("#language-resource-status"),
  languageResourceMessage: document.querySelector("#language-resource-message"),
  checkLanguages: document.querySelector("#check-languages"),
  mediaError: document.querySelector("#media-error"),
  mediaName: document.querySelector("#media-name"),
  progress: document.querySelector("#translation-progress"),
  reveal: document.querySelector("#reveal-button"),
  revealExport: document.querySelector("#reveal-export-button"),
  retry: document.querySelector("#retry-button"),
  sourceLanguage: document.querySelector("#source-language"),
  sourceLanguageError: document.querySelector("#source-language-error"),
  start: document.querySelector("#start-button"),
  subtitleChoice: document.querySelector("#subtitle-choice"),
  subtitleVersion: document.querySelector("#subtitle-version"),
  subtitleLoaded: document.querySelector("#subtitle-loaded"),
  targetLanguage: document.querySelector("#target-language"),
  targetLanguageError: document.querySelector("#target-language-error"),
};
let state = null;
let selectedTrackId = null;
let selectedSourceLanguage = "";
let selectedTargetLanguage = "";
let generationMode = "bilingual";
let generationSource = "audio";
let transcriptionStrategy = "reuse";
let selectedSubtitlePath = "";
let currentMediaPath = "";
let lastPlayerTrackId;
let lastResolvedLanguages = "";
let lastResolvedSubtitlePath;
let lastFeedbackKey = "";
let languageValidationRequested = false;
let lastPreflightKey = "";
let exporting = false;
let lastExportedPath = "";
const progressFeedback = window.createProgressFeedback(elements, () => currentMediaPath, (jobId) => post("progressReady", { jobId }));
const generationControls = window.createGenerationControls?.({
  post, getSelection: () => ({ subtitlePath: selectedSubtitlePath, sourceLanguage: selectedSourceLanguage, targetLanguage: selectedTargetLanguage }),
  onModeChanged: (mode) => { generationMode = mode; if (state) renderState(state); },
  onSourceChanged: (source) => { generationSource = source; if (state) renderState(state); },
  onStrategyChanged: (strategy) => { transcriptionStrategy = strategy; },
});
function post(name, payload) {
  iina.postMessage(name, payload);
}
function fillLanguages(select, selected) {
  select.replaceChildren(new Option("选择语言", ""));
  for (const [identifier, label] of LANGUAGES) {
    select.add(new Option(label, identifier));
  }
  select.value = selected || "";
}
function trackLabel(track) {
  const title =
    track.title || (track.lang ? track.lang.toUpperCase() : `音轨 ${track.id}`);
  return track.available ? title : `${title}（不可读取）`;
}

function updateLanguageErrors() {
  const sameLanguage =
    (generationSource === "existing-subtitle" || generationMode !== "source") && selectedSourceLanguage && selectedSourceLanguage === selectedTargetLanguage;
  const sourceMessage = !selectedSourceLanguage
    ? "请选择源语言。"
    : sameLanguage
      ? "源语言和目标语言不能相同。"
      : "";
  const targetMessage = generationSource === "existing-subtitle" || generationMode !== "source" ? !selectedTargetLanguage
    ? "请选择目标语言。"
    : sameLanguage
      ? "请选择不同的转录语言和翻译语言。"
      : "" : "";
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
  const previousMediaPath = currentMediaPath;
  state = nextState;
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

  const audioTracks = Array.isArray(state.tracks) ? state.tracks : [];
  elements.audioTrack.replaceChildren();
  if (audioTracks.length === 0) {
    elements.audioTrack.add(new Option("没有音轨", ""));
  } else {
    for (const track of audioTracks) {
      const option = new Option(trackLabel(track), String(track.id));
      option.disabled = !track.available;
      elements.audioTrack.add(option);
    }
  }

  const mediaChanged = previousMediaPath !== currentMediaPath;
  if (mediaChanged) {
    selectedSubtitlePath = "";
    languageValidationRequested = false;
    lastExportedPath = "";
    exporting = false;
    elements.exportResult.hidden = true;
    elements.revealExport.hidden = true;
  }
  const selectedTrackChanged =
    String(lastPlayerTrackId) !== String(state.selectedTrackId);
  if (mediaChanged || selectedTrackChanged || selectedTrackId === null) {
    selectedTrackId = state.selectedTrackId;
  }
  const resolvedLanguages = `${state.sourceLanguage || ""}:${state.targetLanguage || ""}`;
  if (mediaChanged || resolvedLanguages !== lastResolvedLanguages) {
    selectedSourceLanguage = state.sourceLanguage || "";
    selectedTargetLanguage = state.targetLanguage || "";
  }
  lastResolvedLanguages = resolvedLanguages;
  lastPlayerTrackId = state.selectedTrackId;
  elements.audioTrack.value =
    selectedTrackId === null ? "" : String(selectedTrackId);
  fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
  fillLanguages(elements.targetLanguage, selectedTargetLanguage);

  const busy = state.jobActive || state.editorOpen || state.associationOpen || state.importOpen || state.job && ["running", "canceling", "loading"].includes(state.job.status);
  const checkingSubtitles = Boolean(
    state.media && state.subtitleLibraryLoading,
  );
  elements.audioTrack.disabled =
    !state.media || audioTracks.length === 0 || busy || generationSource === "existing-subtitle";
  elements.sourceLanguage.disabled = busy || generationSource === "existing-subtitle";
  elements.targetLanguage.disabled = busy || generationMode === "source" && generationSource === "audio";
  elements.targetLanguage.required = generationSource === "existing-subtitle" || generationMode !== "source";
  const allSubtitles = Array.isArray(state.availableSubtitles) ? state.availableSubtitles : [];
  const subtitles = generationSource === "existing-subtitle"
    ? allSubtitles
    : allSubtitles.filter(subtitle =>
      !subtitle.sourceLanguage || !subtitle.targetLanguage ||
      subtitle.sourceLanguage === selectedSourceLanguage && subtitle.targetLanguage === selectedTargetLanguage)
  ;
  elements.existingSubtitles.hidden = subtitles.length === 0;
  elements.reveal.hidden = subtitles.length === 0;
  elements.reveal.disabled = busy;
  document.querySelector("#delete-button").disabled = busy || checkingSubtitles || subtitles.length === 0;
  elements.editSubtitle.disabled = busy || subtitles.length === 0;
  elements.subtitleChoice.replaceChildren();
  for (const subtitle of subtitles) {
    const path = subtitle.path;
    const name = typeof path === "string" ? path.split("/").pop() : "字幕文件";
    const label = (generationSource === "existing-subtitle" ? name : window.sidebarWorkflow?.subtitleLabel(subtitle, LANGUAGES)) || name || "字幕文件";
    const option = new Option(label, path);
    if (typeof option.setAttribute === "function") {
      option.setAttribute("aria-label", label);
    }
    elements.subtitleChoice.add(option);
  }
  if (
    (mediaChanged || state.selectedSubtitlePath !== lastResolvedSubtitlePath) &&
    subtitles.some((subtitle) => subtitle.path === state.selectedSubtitlePath)
  ) {
    selectedSubtitlePath = state.selectedSubtitlePath;
  }
  lastResolvedSubtitlePath = state.selectedSubtitlePath;
  if (!subtitles.some((subtitle) => subtitle.path === selectedSubtitlePath)) {
    selectedSubtitlePath = subtitles.length ? subtitles[0].path : "";
  }
  elements.subtitleChoice.value = selectedSubtitlePath;
  const selectedSubtitle = subtitles.find((subtitle) => subtitle.path === selectedSubtitlePath);
  if (generationSource === "existing-subtitle" && selectedSubtitle?.sourceLanguage) {
    selectedSourceLanguage = selectedSubtitle.sourceLanguage;
    fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
  }
  const sourceOnly = subtitles.find(subtitle => subtitle.path === selectedSubtitlePath)?.mode === "source";
  const displayMode = sourceOnly ? "source" : state.displayMode || "bilingual";
  for (const radio of elements.displayModes) {
    radio.checked = radio.value === displayMode;
    radio.disabled = !state.media || busy || sourceOnly && radio.value !== "source";
  }
  elements.displayMode?.setAttribute?.("data-selected", displayMode);
  if (elements.subtitleVersion) {
    const subtitleVersion = window.sidebarWorkflow?.subtitleVersion(selectedSubtitle) || "";
    elements.subtitleVersion.textContent = subtitleVersion;
    elements.subtitleVersion.hidden = !subtitleVersion;
  }
  elements.subtitleChoice.disabled = subtitles.length === 0 || busy;
  for (const radio of elements.exportModes) {
    radio.disabled = subtitles.length === 0 || busy || exporting || sourceOnly && radio.value !== "source";
    if (sourceOnly) radio.checked = radio.value === "source";
  }
  elements.exportButton.disabled = !state.media || subtitles.length === 0 || busy || checkingSubtitles || exporting;
  elements.reveal.setAttribute(
    "aria-label",
    selectedSubtitlePath
      ? `在 Finder 中显示 ${selectedSubtitlePath.split("/").pop()}`
      : "在 Finder 中显示所选字幕",
  );
  updateLanguageErrors();
  updateGeneration();
  renderJob(checkingSubtitles && (!state.job || state.job.status === "idle")
      ? { status: "checking", message: "正在检查字幕列表" }
      : state.job);
  restoreJobFocus(focused);
  window.sidebarWorkflow?.onState(state);
  window.sidebarSelects?.refresh();
}
function restoreJobFocus(focused) {
  if (![elements.cancel, elements.jobMessage].includes(focused)) return;
  if (focused === elements.cancel && !elements.cancel.hidden && !elements.cancel.disabled) return;
  const target = !elements.start.disabled && elements.start.closest?.("details")?.open !== false ? elements.start
    : !elements.jobStatus.hidden ? elements.jobMessage : null;
  if (!target || target === focused) return;
  if (target === elements.jobMessage) target.tabIndex = -1;
  target.focus();
}
function updateGeneration(force = false) {
  if (!state) return;
  const busy = state.jobActive || state.editorOpen || state.associationOpen || state.importOpen || state.job && ["running", "canceling", "loading"].includes(state.job.status);
  generationControls?.update({ busy, state, sourceMode: generationSource, selectedSubtitlePath, sourceLanguage: selectedSourceLanguage, targetLanguage: selectedTargetLanguage });
  const availableTrack = (state.tracks || []).some((track) => track.available && String(track.id) === String(selectedTrackId));
  const hasSelectedSubtitle = (state.availableSubtitles || []).some((subtitle) => subtitle.path === selectedSubtitlePath);
  const needsTarget = generationSource === "existing-subtitle" || generationMode !== "source";
  elements.start.disabled =
    !state.media ||
    generationSource === "audio" && !availableTrack ||
    generationSource === "existing-subtitle" && !hasSelectedSubtitle ||
    busy ||
    state.editorOpen ||
    state.associationOpen || state.importOpen ||
    state.subtitleLibraryLoading ||
    !selectedSourceLanguage ||
    needsTarget && (!selectedTargetLanguage || selectedSourceLanguage === selectedTargetLanguage);
  const matchingSubtitle = generationSource === "audio" && (state.availableSubtitles || []).some((subtitle) =>
      subtitle.sourceLanguage === selectedSourceLanguage &&
      subtitle.targetLanguage === selectedTargetLanguage);
  elements.start.textContent = generationSource === "existing-subtitle"
    ? "翻译并生成新版本"
    : matchingSubtitle ? "重新生成" : "生成字幕";
  elements.start.setAttribute("aria-label", busy ? "正在生成" : elements.start.textContent);
  renderLanguagePreflight(busy, force);
}
function renderLanguagePreflight(busy, force) {
  const targetLanguage = generationSource === "existing-subtitle" || generationMode !== "source" ? selectedTargetLanguage : "";
  const preflightMode = generationSource === "existing-subtitle" ? "translate" : generationMode;
  const valid = state.media && selectedSourceLanguage && (generationSource === "audio" && generationMode === "source" || targetLanguage && selectedSourceLanguage !== targetLanguage);
  elements.languageResourceStatus.hidden = !valid;
  elements.checkLanguages.disabled = Boolean(busy);
  if (!valid) { lastPreflightKey = ""; return; }
  const key = JSON.stringify([currentMediaPath, selectedSourceLanguage, targetLanguage, preflightMode]);
  const check = [state.languagePreflight, ...(state.languagePreflight?.readyChecks || [])].find(check => check && check.mediaPath === currentMediaPath
    && check.sourceLanguage === selectedSourceLanguage && check.targetLanguage === targetLanguage
    && (check.generationMode || "bilingual") === preflightMode);
  const matches = Boolean(check);
  const status = matches ? check.status : "checking";
  window.sidebarWorkflow?.onPreflight(matches ? check : null);
  elements.languageResourceMessage.textContent = matches ? check.message || "正在检查语言资源" : "正在检查语言资源";
  elements.languageResourceStatus.setAttribute("aria-busy", String(status === "checking"));
  elements.checkLanguages.hidden = status === "checking";
  elements.start.disabled = elements.start.disabled || !matches || status !== "ready";
  if (!busy && key !== lastPreflightKey) {
    lastPreflightKey = key;
    post("checkLanguages", { sourceLanguage: selectedSourceLanguage, targetLanguage, generationMode: preflightMode, force });
  }
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
  elements.jobStatus.hidden = progressFeedback.retracted || current.status === "idle" || (current.status === "available" && !libraryWarning) || (current.status === "completed" && current.loaded && !current.jobId);
  if (current.status === "completed" && current.loaded) elements.jobMessage.textContent = current.jobId ? "字幕已生成并加载" : "字幕已加载";
  window.sidebarWorkflow?.onJob(current);
  elements.jobStatus.dataset.kind =
    noSpeech || libraryWarning ? "warning" : failed ? "error" : current.status === "completed" && current.loaded ? "success" : "info";
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
  elements.progress.setAttribute("aria-label", current.phase === "translating" ? "翻译进度" : "字幕生成进度");
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
  const busy = state && (state.jobActive || state.editorOpen || state.associationOpen || state.importOpen || state.job && ["running", "canceling", "loading"].includes(state.job.status));
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
  const needsTarget = generationSource === "existing-subtitle" || generationMode !== "source";
  if (!selectedSourceLanguage || needsTarget && !selectedTargetLanguage) {
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
  const payload = generationSource === "existing-subtitle"
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
      targetLanguage: generationMode === "source" ? "" : selectedTargetLanguage,
      generationMode,
      forceTranscription: transcriptionStrategy === "force",
    };
  const matching = (state.availableSubtitles || []).some((subtitle) =>
    (generationSource === "audio" || subtitle.path !== selectedSubtitlePath) &&
    subtitle.sourceLanguage === selectedSourceLanguage &&
    subtitle.targetLanguage === selectedTargetLanguage);
  const start = () => post("start", payload);
  if (window.sidebarWorkflow) window.sidebarWorkflow.requestStart(payload, matching, start);
  else start();
});

elements.cancel.addEventListener("click", () => post("cancel"));
elements.checkLanguages.addEventListener("click", () => {
  lastPreflightKey = "";
  if (state) state.languagePreflight = null;
  updateGeneration(true);
});
elements.subtitleChoice.addEventListener("change", () => {
  selectedSubtitlePath = elements.subtitleChoice.value;
  if (state) renderState(state);
  post("loadExisting", selectedSubtitlePath);
});
elements.retry.addEventListener("click", () => post("retryLoad"));
elements.reveal.addEventListener("click", () => post("reveal", elements.subtitleChoice.value));
elements.exportButton.addEventListener("click", () => {
  const selectedMode = Array.from(elements.exportModes).find((radio) => radio.checked);
  if (!selectedSubtitlePath || !selectedMode || elements.exportButton.disabled) return;
  post("exportSubtitle", { subtitlePath: selectedSubtitlePath, mode: selectedMode.value });
});
elements.revealExport.addEventListener("click", () => {
  if (lastExportedPath) post("reveal", lastExportedPath);
});
elements.editSubtitle.addEventListener("click", () => post("editSubtitle", elements.subtitleChoice.value));
iina.onMessage("state", renderState);
iina.onMessage("exportResult", (result) => {
  const current = result || {};
  exporting = current.status === "running";
  elements.exportResult.hidden = current.status === "cancelled";
  elements.exportResult.dataset.kind = current.status === "error" ? "error" : "info";
  if (current.status === "success") {
    lastExportedPath = current.path;
    elements.exportMessage.textContent = `已导出：${String(current.path || "").split("/").pop()}`;
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
  const focused = document.activeElement;
  if (state) {
    state.job = job;
    state.hasOutput = Boolean(job.path || state.hasOutput);
  }
  renderJob(job);
  updateGeneration();
  restoreJobFocus(focused);
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
