function prepareGeneration(payload = {}, tracks, resolveAudioStreamIndex) {
  const generationMode = payload.generationMode || "bilingual";
  if (!["bilingual", "source", "translate"].includes(generationMode)) throw new Error("生成模式无效。");
  const sourceLanguage = String(payload.sourceLanguage || "");
  const targetLanguage = generationMode === "source" ? "" : String(payload.targetLanguage || "");
  const language = /^[a-zA-Z0-9]{1,8}(?:-[a-zA-Z0-9]{1,8})*$/;
  if (!language.test(sourceLanguage) || (generationMode !== "source" &&
      (!language.test(targetLanguage) || sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()))) {
    throw new Error("请选择有效的源语言和不同的目标语言。");
  }
  if (generationMode === "translate" && (typeof payload.inputSubtitlePath !== "string" || !payload.inputSubtitlePath.startsWith("/"))) {
    throw new Error("请选择要翻译的字幕文件。");
  }
  return {
    generationMode, sourceLanguage, targetLanguage,
    streamIndex: generationMode === "translate" ? -1 : resolveAudioStreamIndex(tracks, payload.trackId),
  };
}

async function executeGeneration({ utils, helperPath, request, createJsonLineParser, onEvent, onParseError, claimedJob }) {
  const parser = createJsonLineParser(onEvent, onParseError);
  claimedJob.parser = parser;
  let stderr = "";
  const result = await utils.exec(helperPath, ["--request-json", JSON.stringify(request)], null,
    (chunk) => parser.push(chunk), (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
  parser.flush();
  if (claimedJob.completion) await claimedJob.completion;
  return { result, stderr };
}

function createSubtitleImportRuntime({ getContext, exec, start, onChanged, onError }) {
  let pending = false;
  return {
    isOpen: () => pending,
    async import(payload = {}) {
      const initial = getContext();
      if (pending || initial.busy || !initial.mediaPath || !initial.helperPath) return;
      pending = true;
      onChanged();
      try {
        const result = await exec(initial.helperPath, ["--choose-subtitle-json"]);
        if (!result || result.status !== 0) throw new Error(result?.stderr || "无法打开字幕选择窗口。");
        const response = JSON.parse(result.stdout);
        if (response.message) throw new Error(String(response.message));
        if (response.path === null) return;
        if (typeof response.path !== "string" || !response.path.startsWith("/") || !/\.srt$/i.test(response.path)) {
          throw new Error("字幕工具返回的文件路径无效。");
        }
        const current = getContext();
        if (current.mediaPath !== initial.mediaPath || current.outputDirectoryPath !== initial.outputDirectoryPath) return;
        pending = false;
        onChanged();
        await start({ ...payload, generationMode: "translate", inputSubtitlePath: response.path });
      } catch (error) {
        const current = getContext();
        if (current.mediaPath === initial.mediaPath && current.outputDirectoryPath === initial.outputDirectoryPath) onError(error);
      } finally {
        if (pending) { pending = false; onChanged(); }
      }
    },
  };
}

async function cancelGeneration({ jobController, replaceJob, jobState, send, utils, onError }) {
  const runningJob = jobController.current();
  if (!runningJob || !runningJob.cancelPath) return;
  jobController.requestCancel();
  replaceJob({ ...jobState(), status: "canceling", message: "正在取消" });
  send("job", jobState());
  try {
    await utils.exec("/usr/bin/touch", [runningJob.cancelPath]);
  } catch (error) {
    onError(`无法发送取消请求：${error.message || error}`);
  }
}

module.exports = { prepareGeneration, executeGeneration, createSubtitleImportRuntime, cancelGeneration };
