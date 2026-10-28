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
const LANGUAGE_ALIASES = {
  ara: "ar", chi: "zh", deu: "de", eng: "en", fre: "fr", ger: "de",
  hin: "hi", ita: "it", jpn: "ja", kor: "ko", por: "pt", rus: "ru",
  spa: "es", tha: "th", vie: "vi", zho: "zh",
};

const elements = {
  audioTrack: document.querySelector("#audio-track"),
  autoLoad: document.querySelector("#auto-load"),
  cancel: document.querySelector("#cancel-button"),
  chooseFFmpeg: document.querySelector("#choose-ffmpeg"),
  chooseOutput: document.querySelector("#choose-output"),
  existingSubtitles: document.querySelector("#existing-subtitles"),
  ffmpegPath: document.querySelector("#ffmpeg-path"),
  jobForm: document.querySelector("#job-form"),
  jobMessage: document.querySelector("#job-message"),
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
  targetLanguage: document.querySelector("#target-language"),
};

let state = null;
let selectedTrackId = null;
let selectedSourceLanguage = "";
let selectedTargetLanguage = "";
let selectedSubtitlePath = "";
let currentMediaPath = "";
let lastPlayerTrackId;

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
  const title = track.title || (track.lang ? track.lang.toUpperCase() : `音轨 ${track.id}`);
  return track.available ? title : `${title}（不可读取）`;
}

function renderState(nextState) {
  const previousMediaPath = currentMediaPath;
  state = nextState;
  currentMediaPath = state.media ? state.media.path : "";
  elements.mediaName.textContent = state.media ? (state.title || state.media.name) : (state.title || "未打开视频");
  elements.mediaError.textContent = state.mediaError || (state.title && !state.media ? "仅支持本地文件视频。" : "");

  const audioTracks = Array.isArray(state.tracks) ? state.tracks : [];
  const availableTrackExists = audioTracks.some((track) => track.available);
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
    const activeTrack = audioTracks.find((track) => String(track.id) === String(selectedTrackId));
    selectedSourceLanguage = state.sourceLanguage || "";
    if (!selectedSourceLanguage && activeTrack) selectedSourceLanguage = normalizeLanguage(activeTrack.lang);
    selectedTargetLanguage = state.targetLanguage || "";
  }
  lastPlayerTrackId = state.selectedTrackId;
  elements.audioTrack.value = selectedTrackId === null ? "" : String(selectedTrackId);
  fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
  fillLanguages(elements.targetLanguage, selectedTargetLanguage);

  const busy = state.job && ["running", "canceling", "loading"].includes(state.job.status);
  const checkingSubtitles = Boolean(state.media && state.subtitleLibraryLoading);
  elements.start.disabled = !state.media || !availableTrackExists || busy || checkingSubtitles;
  elements.audioTrack.disabled = !state.media || audioTracks.length === 0 || busy;
  elements.sourceLanguage.disabled = busy;
  elements.targetLanguage.disabled = busy;
  elements.autoLoad.checked = Boolean(state.autoLoad);
  elements.autoLoad.disabled = busy;
  const subtitles = Array.isArray(state.availableSubtitles) ? state.availableSubtitles : [];
  elements.existingSubtitles.hidden = subtitles.length === 0;
  elements.subtitleChoice.replaceChildren();
  for (const subtitle of subtitles) {
    const path = subtitle.path;
    const name = typeof path === "string" ? path.split("/").pop() : "字幕文件";
    elements.subtitleChoice.add(new Option(name || "字幕文件", path));
  }
  if (!subtitles.some((subtitle) => subtitle.path === selectedSubtitlePath)) {
    selectedSubtitlePath = subtitles.length ? subtitles[0].path : "";
  }
  elements.subtitleChoice.value = selectedSubtitlePath;
  elements.subtitleChoice.disabled = subtitles.length === 0 || busy;
  elements.start.textContent = subtitles.length ? "重新生成" : "生成";
  elements.ffmpegPath.value = state.ffmpegPath || "";
  elements.outputDirectory.value = state.outputDirectory || "";
  elements.outputDefault.textContent = state.effectiveOutputDirectory
    ? `字幕库位置：${state.effectiveOutputDirectory}`
    : "留空时使用 Otoha 字幕库。";
  renderJob(checkingSubtitles && (!state.job || state.job.status === "idle")
    ? { status: "checking", message: "正在检查已有字幕" }
    : state.job);
}

function renderJob(job) {
  const current = job || { status: "idle", message: "选择音轨和语言后开始" };
  elements.jobMessage.textContent = current.message || (current.status === "idle" ? "选择音轨和语言后开始" : "处理中");
  elements.cancel.hidden = !["running", "canceling"].includes(current.status);
  elements.cancel.disabled = current.status === "canceling";
  elements.retry.hidden = current.status !== "load-error";
  elements.reveal.hidden = !(current.path || (state && state.hasOutput));
  elements.progress.hidden = current.phase !== "translating" || !Number.isFinite(current.progress);
  if (!elements.progress.hidden) elements.progress.value = current.progress;
}

elements.audioTrack.addEventListener("change", () => {
  selectedTrackId = elements.audioTrack.value;
  const track = (state.tracks || []).find((item) => String(item.id) === String(selectedTrackId));
  selectedSourceLanguage = track && track.lang ? normalizeLanguage(track.lang) : "";
  fillLanguages(elements.sourceLanguage, selectedSourceLanguage);
});

elements.sourceLanguage.addEventListener("change", () => {
  selectedSourceLanguage = elements.sourceLanguage.value;
});

elements.targetLanguage.addEventListener("change", () => {
  selectedTargetLanguage = elements.targetLanguage.value;
});

elements.autoLoad.addEventListener("change", () => {
  post("setSetting", { key: "auto_load", value: elements.autoLoad.checked });
});

elements.jobForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (selectedSourceLanguage === selectedTargetLanguage) {
    elements.jobMessage.textContent = "请选择不同的转录语言和翻译语言。";
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
  post("loadExisting", selectedSubtitlePath);
});
elements.retry.addEventListener("click", () => post("retryLoad"));
elements.reveal.addEventListener("click", () => post(
  "reveal",
  elements.subtitleChoice.value || (state && state.job && state.job.path),
));
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
});

const helperURL = new URL("bin/OtohaHelper.app/Contents/MacOS/otoha-helper", window.location.href);
iina.postMessage("ready", { helperPath: decodeURIComponent(helperURL.pathname) });
iina.postMessage("refresh");
window.setInterval(() => post("refresh"), 2500);

function normalizeLanguage(value) {
  const raw = String(value || "").replaceAll("_", "-").split("-");
  const rawLanguage = (raw[0] || "").toLowerCase();
  const language = LANGUAGE_ALIASES[rawLanguage] || rawLanguage;
  if (language === "zh") {
    return raw.some((part) => /^(hant|tw|hk|mo)$/i.test(part)) ? "zh-Hant" : "zh-Hans";
  }
  if (language === "pt") {
    const region = raw[1] && raw[1].toLowerCase();
    return !region || region === "br" ? "pt-BR" : "";
  }
  return LANGUAGES.some(([identifier]) => identifier.toLowerCase() === language) ? language : "";
}
