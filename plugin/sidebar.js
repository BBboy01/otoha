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
  autoLoad: document.querySelector("#auto-load"),
  autoLoadHelp: document.querySelector("#auto-load-help"),
  cancel: document.querySelector("#cancel-button"),
  chooseFFmpeg: document.querySelector("#choose-ffmpeg"),
  chooseOutput: document.querySelector("#choose-output"),
  existingSubtitles: document.querySelector("#existing-subtitles"),
  ffmpegPath: document.querySelector("#ffmpeg-path"),
  jobForm: document.querySelector("#job-form"),
  jobMessage: document.querySelector("#job-message"),
  jobStatus: document.querySelector("#job-status"),
  jobIcon: document.querySelector("#job-icon"),
  jobDetailToggle: document.querySelector("#job-detail-toggle"),
  jobDetailMessage: document.querySelector("#job-detail-message"),
  mediaError: document.querySelector("#media-error"),
  mediaName: document.querySelector("#media-name"),
  outputDefault: document.querySelector("#output-default"),
  outputDirectory: document.querySelector("#output-directory"),
  progress: document.querySelector("#translation-progress"),
  reveal: document.querySelector("#reveal-button"),
  retry: document.querySelector("#retry-button"),
  sourceLanguage: document.querySelector("#source-language"),
  start: document.querySelector("#start-button"),
  subtitleChoice: document.querySelector("#subtitle-choice"),
  subtitleLoaded: document.querySelector("#subtitle-loaded"),
  targetLanguage: document.querySelector("#target-language"),
};

let state = null;
let selectedTrackId = null;
let selectedSourceLanguage = "";
let selectedTargetLanguage = "";
let selectedSubtitlePath = "";
let currentMediaPath = "";
let lastPlayerTrackId;
let lastResolvedLanguages = "";
let lastResolvedSubtitlePath;
let lastFeedbackKey = "";

function post(name, payload) {
  iina.postMessage(name, payload);
}

elements.autoLoadHelp.addEventListener("click", () => elements.autoLoadHelp.focus());

function fillLanguages(select, selected) {
  select.replaceChildren(new Option("选择语言", ""));
  for (const [identifier, label] of LANGUAGES) {
    select.add(new Option(label, identifier));
  }
  select.value = selected || "";
}

function trackLabel(track) {
  const title = track.title || (track.lang ? track.lang.toUpperCase() : `音轨 ${track.id}`);
  return track.available ? title : `${title}（不可读取）`;
}

function renderState(nextState) {
  const previousMediaPath = currentMediaPath;
  state = nextState;
  currentMediaPath = state.media ? state.media.path : "";
  const mediaName = state.media ? (state.title || state.media.name) : (state.title || "未打开视频");
  elements.mediaName.textContent = mediaName;
  elements.mediaName.title = mediaName;
  elements.mediaError.textContent = state.mediaError || (state.title && !state.media ? "仅支持本地文件视频。" : "");

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
  if (mediaChanged) selectedSubtitlePath = "";
  const selectedTrackChanged = String(lastPlayerTrackId) !== String(state.selectedTrackId);
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
  elements.audioTrack.value = selectedTrackId === null ? "" : String(selectedTrackId);
  fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
  fillLanguages(elements.targetLanguage, selectedTargetLanguage);

  const busy = state.job && ["running", "canceling", "loading"].includes(state.job.status);
  const checkingSubtitles = Boolean(state.media && state.subtitleLibraryLoading);
  elements.audioTrack.disabled = !state.media || audioTracks.length === 0 || busy;
  elements.sourceLanguage.disabled = busy;
  elements.targetLanguage.disabled = busy;
  elements.autoLoad.checked = Boolean(state.autoLoad);
  elements.autoLoad.disabled = busy;
  const subtitles = Array.isArray(state.availableSubtitles) ? state.availableSubtitles : [];
  elements.existingSubtitles.hidden = subtitles.length === 0;
  elements.reveal.hidden = subtitles.length === 0;
  elements.reveal.disabled = busy;
  elements.subtitleChoice.replaceChildren();
  for (const subtitle of subtitles) {
    const path = subtitle.path;
    const name = typeof path === "string" ? path.split("/").pop() : "字幕文件";
    elements.subtitleChoice.add(new Option(name || "字幕文件", path));
  }
  if ((mediaChanged || state.selectedSubtitlePath !== lastResolvedSubtitlePath)
    && subtitles.some((subtitle) => subtitle.path === state.selectedSubtitlePath)) {
    selectedSubtitlePath = state.selectedSubtitlePath;
  }
  lastResolvedSubtitlePath = state.selectedSubtitlePath;
  if (!subtitles.some((subtitle) => subtitle.path === selectedSubtitlePath)) {
    selectedSubtitlePath = subtitles.length ? subtitles[0].path : "";
  }
  elements.subtitleChoice.value = selectedSubtitlePath;
  elements.subtitleChoice.disabled = subtitles.length === 0 || busy;
  updateGeneration();
  elements.ffmpegPath.value = state.ffmpegPath || "";
  elements.outputDirectory.value = state.outputDirectory || "";
  elements.outputDefault.textContent = state.effectiveOutputDirectory
    ? `字幕库位置：${state.effectiveOutputDirectory}`
    : "留空时使用 Otoha 字幕库。";
  renderJob(checkingSubtitles && (!state.job || state.job.status === "idle")
    ? { status: "checking", message: "正在检查已有字幕" }
    : state.job);
}

function updateGeneration() {
  if (!state) return;
  const busy = state.job && ["running", "canceling", "loading"].includes(state.job.status);
  const availableTrack = (state.tracks || []).some((track) => track.available && String(track.id) === String(selectedTrackId));
  elements.start.disabled = !state.media || !availableTrack || busy || state.subtitleLibraryLoading
    || !selectedSourceLanguage || !selectedTargetLanguage || selectedSourceLanguage === selectedTargetLanguage;
  const matchingSubtitle = (state.availableSubtitles || []).some((subtitle) => (
    subtitle.sourceLanguage === selectedSourceLanguage && subtitle.targetLanguage === selectedTargetLanguage
  ));
  elements.start.textContent = matchingSubtitle ? "重新生成" : "生成";
}

function renderJob(job) {
  const current = job || { status: "idle", message: "" };
  const message = current.message || "";
  const failed = ["error", "load-error"].includes(current.status);
  const noSpeech = failed && message.includes("没有识别到语音");
  const libraryWarning = (current.status === "available" && message.includes("失败"))
    || (current.status === "error" && message.startsWith("无法读取已有字幕："));
  const hasDetails = (failed || libraryWarning) && Boolean(message);
  const feedbackKey = JSON.stringify([currentMediaPath, current.status, message]);
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
  elements.jobStatus.hidden = current.status === "idle"
    || (current.status === "completed" && current.loaded === true)
    || (current.status === "available" && !libraryWarning);
  elements.jobStatus.dataset.kind = noSpeech || libraryWarning ? "warning" : failed ? "error" : "info";
  elements.jobIcon.hidden = !failed && !libraryWarning;
  elements.jobDetailToggle.hidden = !hasDetails;
  elements.jobDetailMessage.textContent = hasDetails ? message : "";
  if (!hasDetails) elements.jobDetailMessage.hidden = true;
  const subtitles = state && state.availableSubtitles || [];
  elements.subtitleLoaded.hidden = !(current.status === "completed" && current.loaded === true
    && current.path === selectedSubtitlePath
    && subtitles.some((subtitle) => subtitle.path === current.path));
  elements.cancel.hidden = !["running", "canceling"].includes(current.status);
  elements.cancel.disabled = current.status === "canceling";
  elements.retry.hidden = current.status !== "load-error";
  elements.progress.hidden = current.phase !== "translating" || !Number.isFinite(current.progress);
  if (!elements.progress.hidden) elements.progress.value = current.progress;
}

elements.jobDetailToggle.addEventListener("click", () => {
  elements.jobDetailMessage.hidden = !elements.jobDetailMessage.hidden;
  elements.jobDetailToggle.setAttribute("aria-expanded", String(!elements.jobDetailMessage.hidden));
});

elements.audioTrack.addEventListener("change", () => {
  selectedTrackId = elements.audioTrack.value;
  updateGeneration();
});

elements.sourceLanguage.addEventListener("change", () => {
  selectedSourceLanguage = elements.sourceLanguage.value;
  updateGeneration();
});

elements.targetLanguage.addEventListener("change", () => {
  selectedTargetLanguage = elements.targetLanguage.value;
  updateGeneration();
});

elements.autoLoad.addEventListener("change", () => {
  post("setSetting", { key: "auto_load", value: elements.autoLoad.checked });
});

elements.jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedSourceLanguage || !selectedTargetLanguage) {
    renderJob({ status: "validation", message: "请选择转录语言和翻译语言。" });
    return;
  }
  if (selectedSourceLanguage === selectedTargetLanguage) {
    renderJob({ status: "validation", message: "请选择不同的转录语言和翻译语言。" });
    return;
  }
  post("start", {
    trackId: selectedTrackId,
    sourceLanguage: selectedSourceLanguage,
    targetLanguage: selectedTargetLanguage,
  });
});

elements.cancel.addEventListener("click", () => post("cancel"));
elements.subtitleChoice.addEventListener("change", () => {
  selectedSubtitlePath = elements.subtitleChoice.value;
  renderJob(state && state.job);
  post("loadExisting", selectedSubtitlePath);
});
elements.retry.addEventListener("click", () => post("retryLoad"));
elements.reveal.addEventListener("click", () => post("reveal", elements.subtitleChoice.value));
elements.chooseFFmpeg.addEventListener("click", () => post("chooseFFmpeg"));
elements.chooseOutput.addEventListener("click", () => post("chooseOutputDirectory"));

elements.ffmpegPath.addEventListener("change", () => {
  post("setSetting", { key: "ffmpeg_path", value: elements.ffmpegPath.value });
});

elements.outputDirectory.addEventListener("change", () => {
  post("setSetting", { key: "output_directory", value: elements.outputDirectory.value });
});

iina.onMessage("state", renderState);
iina.onMessage("job", (job) => {
  if (state) {
    state.job = job;
    state.hasOutput = Boolean(job.path || state.hasOutput);
  }
  renderJob(job);
  updateGeneration();
});

const helperURL = new URL("bin/OtohaHelper.app/Contents/MacOS/otoha-helper", window.location.href);
iina.postMessage("ready", { helperPath: decodeURIComponent(helperURL.pathname) });
iina.postMessage("refresh");
window.setInterval(() => post("refresh"), 2500);
