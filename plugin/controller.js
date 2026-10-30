const { parseHelperEvent, PROTOCOL_VERSION } = require("./protocol.js");

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

function localMedia(value) {
  if (typeof value !== "string" || !value) throw new Error("请先打开本地文件视频。");

  let path;
  if (value.startsWith("file:")) {
    const match = value.match(/^file:(?:\/\/([^/]*))?(\/[^?#]*)(?:[?#].*)?$/i);
    if (!match) throw new Error("当前视频的本地文件路径无效。");
    const hostname = match[1] || "";
    if (hostname && hostname.toLowerCase() !== "localhost") {
      throw new Error("仅支持本地文件视频。");
    }
    try {
      path = decodeURIComponent(match[2]);
    } catch {
      throw new Error("当前视频的本地文件路径无效。");
    }
  } else if (value.startsWith("/")) {
    path = value;
  } else {
    throw new Error("仅支持本地文件视频。");
  }

  const name = path.split("/").filter(Boolean).pop() || path;
  return { path, name };
}

function waitForSubtitleTrack(mpv, filePath, now = Date.now, schedule = setTimeout) {
  const expectedPath = localMedia(filePath).path;
  const deadline = now() + 3000;

  return new Promise((resolve, reject) => {
    const check = () => {
      const loaded = (mpv.getNative("track-list") || []).some((track) => {
        if (!track || track.type !== "sub") return false;
        const externalFilename = track["external-filename"] || track.externalFilename;
        if (typeof externalFilename !== "string") return false;
        try {
          return localMedia(externalFilename).path === expectedPath;
        } catch {
          return externalFilename === expectedPath;
        }
      });
      if (loaded) resolve();
      else if (now() >= deadline) reject(new Error("IINA 尚未确认字幕轨道加载，请重试或在播放器中检查字幕轨道。"));
      else schedule(check, 100);
    };
    check();
  });
}

function audioTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) return [];
  return rawTracks
    .filter((track) => track && track.type === "audio")
    .map((track) => {
      const streamIndex = Number.isInteger(track["ff-index"]) && track["ff-index"] >= 0
        ? track["ff-index"]
        : null;
      return {
        id: track.id,
        streamIndex: track.external ? null : streamIndex,
        lang: typeof track.lang === "string" ? track.lang : "",
        title: typeof track.title === "string" ? track.title : "",
        available: !track.external && streamIndex !== null,
      };
    });
}

function resolveAudioStreamIndex(tracks, id) {
  const track = tracks.find((item) => String(item.id) === String(id));
  if (!track) throw new Error("所选音轨已不可用，请重新选择音轨。");
  if (!track.available || !Number.isInteger(track.streamIndex) || track.streamIndex < 0) {
    throw new Error("所选音轨没有可用的 FFmpeg ff-index。");
  }
  return track.streamIndex;
}

function normalizeLanguage(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const parts = value.trim().replaceAll("_", "-").split("-");
  const rawLanguage = parts[0].toLowerCase();
  const language = LANGUAGE_ALIASES[rawLanguage] || rawLanguage;
  if (language === "zh") {
    const script = parts.find((part) => /^(hans|hant)$/i.test(part));
    const region = parts.find((part) => /^[a-z]{2}$/i.test(part));
    if ((script && script.toLowerCase() === "hant") || ["tw", "hk", "mo"].includes((region || "").toLowerCase())) {
      return "zh-Hant";
    }
    return "zh-Hans";
  }
  if (language === "pt") {
    const region = parts[1] && parts[1].toLowerCase();
    return !region || region === "br" ? "pt-BR" : "";
  }
  return LANGUAGES.some(([identifier]) => identifier.toLowerCase() === language)
    ? language
    : "";
}

function defaultLanguage(value) {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    const normalized = normalizeLanguage(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function createJsonLineParser(onEvent, onError = () => {}) {
  let buffer = "";
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(parseHelperEvent(JSON.parse(trimmed)));
    } catch (error) {
      onError(error);
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach(consume);
    },
    flush() {
      consume(buffer);
      buffer = "";
    },
  };
}

function phaseLabel(phase) {
  const labels = {
    checkingEnvironment: "检查环境",
    preparingLanguageResources: "准备语言资源",
    extractingAudio: "提取音轨",
    transcribing: "转录语音",
    translating: "翻译字幕",
    saving: "保存双语字幕",
    loading: "加载字幕",
  };
  return labels[phase] || "处理中";
}

async function resolveFFmpegPath(preferences, exec) {
  const configuredPath = preferences.get("ffmpeg_path");
  if (typeof configuredPath === "string" && configuredPath.trim()) {
    const filePath = configuredPath.trim();
    await assertExecutableFile(exec, filePath, "配置的 FFmpeg 路径不存在或不可执行，请选择可执行文件或清空设置后重试。");
    return filePath;
  }

  const result = await exec("/bin/zsh", ["-lc", "command -v ffmpeg"]);
  const candidates = String(result.stdout || "").trim().split(/\r?\n/).filter(Boolean);
  const discoveredPath = candidates[candidates.length - 1];
  if (result.status !== 0 || !discoveredPath || !discoveredPath.startsWith("/")) {
    throw new Error("未找到 FFmpeg。请安装后重试，或在路径设置中填写可执行文件的完整路径。");
  }
  await assertExecutableFile(exec, discoveredPath, "找到的 FFmpeg 不可执行，请检查安装或在路径设置中填写可执行文件的完整路径。");
  return discoveredPath;
}

async function assertExecutableFile(exec, filePath, message) {
  if (!filePath.startsWith("/")) throw new Error(message);
  try {
    const result = await exec("/bin/zsh", ["-lc", 'test -f "$1" && test -x "$1"', "--", filePath]);
    if (result.status !== 0) throw new Error(message);
  } catch (error) {
    if (error && error.message === message) throw error;
    throw new Error(message);
  }
}

module.exports = {
  LANGUAGES,
  PROTOCOL_VERSION,
  audioTracks,
  createJsonLineParser,
  defaultLanguage,
  localMedia,
  waitForSubtitleTrack,
  normalizeLanguage,
  phaseLabel,
  resolveFFmpegPath,
  resolveAudioStreamIndex,
};
