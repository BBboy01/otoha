const { PROTOCOL_VERSION } = require("./protocol.js");
const RESOURCE_STATES = ["unsupported", "supported", "downloading", "installed"];

function createLanguagePreflightClient({ exec, helperPath, onUpdated }) {
  let sequence = 0;
  let state = { status: "idle" };
  let pending = null;
  function replace(next) { state = Object.freeze(next); onUpdated(); }
  function reset() { sequence += 1; replace({ status: "idle" }); }

  async function check(input = {}, force = false) {
    const { sourceLanguage, targetLanguage, mediaPath = "" } = input;
    if (!sourceLanguage || !targetLanguage || sourceLanguage === targetLanguage) { reset(); return; }
    const same = state.sourceLanguage === sourceLanguage && state.targetLanguage === targetLanguage && state.mediaPath === mediaPath;
    if (!force && same && state.status === "ready") return;
    if (!force && same && state.status === "checking") return pending;
    const operation = ++sequence;
    const request = { protocolVersion: PROTOCOL_VERSION, requestId: `language-${operation}`, sourceLanguage, targetLanguage };
    replace({ sourceLanguage, targetLanguage, mediaPath, status: "checking", message: "正在检查语言资源" });
    pending = (async () => {
      try {
        const path = helperPath();
        if (!path) throw new Error("helper 尚未就绪，请重新打开侧栏后重试。");
        const result = await exec(path, ["--check-languages-json", JSON.stringify(request)]);
        if (operation !== sequence) return;
        if (!result || result.status !== 0) throw new Error(String(result?.stderr || "语言检查失败，请重试。").slice(-2000));
        const value = JSON.parse(result.stdout);
        if (value.protocolVersion !== PROTOCOL_VERSION || value.requestId !== request.requestId
          || value.sourceLanguage !== sourceLanguage || value.targetLanguage !== targetLanguage
          || !RESOURCE_STATES.includes(value.speech) || !RESOURCE_STATES.includes(value.translation)) {
          throw new Error("语言检查返回无效结果，请重试。");
        }
        const errorCode = value.speech === "unsupported" ? "speech.unsupportedLanguage"
          : value.translation === "unsupported" ? "translation.unsupportedLanguage"
          : value.translation !== "installed" ? "translation.resourcesMissing" : null;
        const messages = {
          "speech.unsupportedLanguage": "所选源语言不支持转录，请选择其他语言。",
          "translation.unsupportedLanguage": "所选翻译语言对不可用，请选择其他语言。",
          "translation.resourcesMissing": "翻译资源尚未安装。请通过 macOS 的翻译功能下载源语言和目标语言，再重新检查。",
        };
        replace({ ...request, mediaPath, speech: value.speech, translation: value.translation,
          status: errorCode ? "unavailable" : "ready", errorCode,
          message: errorCode ? messages[errorCode] : value.speech === "installed" ? "语言资源可用"
            : "翻译资源可用；生成时准备语音模型，macOS 可能要求下载资源。" });
      } catch (error) {
        if (operation !== sequence) return;
        replace({ ...request, mediaPath, status: "error", errorCode: "helper.unknown", message: error.message || String(error) });
      }
    })();
    return pending;
  }
  return { check, reset, getState: () => state };
}

module.exports = { createLanguagePreflightClient };
