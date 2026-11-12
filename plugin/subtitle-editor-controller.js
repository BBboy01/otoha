const { PROTOCOL_VERSION, ERROR_CODES } = require("./protocol.js");

function createSubtitleEditorController({
  file,
  utils,
  getContext,
  send,
  onChanged,
  onSaved,
  seek,
}) {
  let session = null;
  let sequence = 0;

  function publish(status, message = "", errorCode = null) {
    if (!session) return;
    session.status = status;
    send({
      sessionId: session.id,
      status,
      message,
      errorCode,
      mediaPath: session.input.mediaPath,
      path: session.input.subtitlePath,
      snapshot: session.snapshot,
    });
    onChanged();
  }

  function currentContext() {
    const context = getContext();
    if (
      !session ||
      context.busy ||
      context.mediaPath !== session.input.mediaPath ||
      context.outputDirectoryPath !== session.input.outputDirectoryPath ||
      !context.files.some((item) => item.path === session.input.subtitlePath)
    ) {
      throw Object.assign(
        new Error("视频或字幕库已切换。草稿已保留，请回到原视频后再保存。"),
        { code: "subtitle.editOutsideLibrary" },
      );
    }
    return context;
  }

  async function request(command, input) {
    const context = getContext();
    if (!context.helperPath)
      throw new Error("字幕工具尚未就绪，请重新打开侧栏。");
    let temporaryPath = null;
    const responsePath = `@tmp/otoha-edit-response-${Date.now()}-${++sequence}.json`;
    try {
      let argument = JSON.stringify(input);
      if (command === "--save-subtitle-file") {
        temporaryPath = `@tmp/otoha-edit-${Date.now()}-${++sequence}.json`;
        file.write(temporaryPath, argument);
        argument = utils.resolvePath(temporaryPath);
        if (!argument) throw new Error("无法创建字幕保存请求。");
      }
      file.write(responsePath, "");
      const responseFile = utils.resolvePath(responsePath);
      if (!responseFile) throw new Error("无法创建字幕响应文件。");
      const result = await utils.exec(context.helperPath, [command, argument, "--subtitle-response-file", responseFile]);
      if (!result || result.status !== 0)
        throw new Error(String(result?.stderr || "字幕工具运行失败，请重试。"));
      const response = JSON.parse(file.read(responseFile));
      if (
        response.protocolVersion !== PROTOCOL_VERSION ||
        response.requestId !== input.requestId
      )
        throw new Error("字幕工具返回无效响应。");
      if (response.code) {
        if (!ERROR_CODES.includes(response.code))
          throw new Error("字幕工具返回未知错误。");
        throw Object.assign(new Error(response.message || "字幕保存失败。"), {
          code: response.code,
        });
      }
      const snapshot = response.snapshot;
      if (
        !snapshot ||
        snapshot.path !== input.subtitlePath ||
        !/^[a-f0-9]{64}$/.test(snapshot.revision) ||
        !Array.isArray(snapshot.cues) ||
        !snapshot.cues.length ||
        snapshot.cues.some(
          (cue) =>
            !Number.isFinite(cue.start) ||
            !Number.isFinite(cue.end) ||
            cue.start < 0 ||
            cue.end <= cue.start ||
            typeof cue.source !== "string" ||
            typeof cue.translation !== "string",
        )
      )
        throw new Error("字幕工具返回无效片段。");
      return snapshot;
    } finally {
      for (const path of [temporaryPath, responsePath].filter(Boolean)) {
        try {
          file.delete(path);
        } catch {}
      }
    }
  }

  async function open(path) {
    if (session) return;
    const context = getContext();
    if (
      context.busy ||
      !context.mediaPath ||
      !context.files.some((item) => item.path === path)
    )
      return;
    session = {
      id: `edit-${Date.now()}-${++sequence}`,
      snapshot: null,
      status: "loading",
      input: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: `read-${sequence}`,
        mediaPath: context.mediaPath,
        subtitlePath: path,
        outputDirectoryPath: context.outputDirectoryPath,
      },
    };
    const active = session;
    publish("loading", "正在读取字幕");
    try {
      const snapshot = await request("--read-subtitle-json", active.input);
      if (session !== active) return;
      active.snapshot = snapshot;
      publish("ready");
    } catch (error) {
      if (session === active)
        publish(
          "error",
          error.message || String(error),
          error.code || "subtitle.libraryFailed",
        );
    }
  }

  async function save(payload = {}) {
    if (
      !session ||
      session.id !== payload.sessionId ||
      !session.snapshot ||
      session.status === "saving"
    )
      return;
    const active = session;
    try {
      currentContext();
      const texts = payload.texts;
      if (
        !Array.isArray(texts) ||
        texts.length !== active.snapshot.cues.length ||
        texts.some(
          (text) =>
            typeof text.source !== "string" ||
            typeof text.translation !== "string" ||
            !text.source.trim() ||
            !text.translation.trim(),
        )
      )
        throw new Error("每句字幕都需要原文和译文。");
      publish("saving", "正在保存字幕");
      const snapshot = await request("--save-subtitle-file", {
        ...active.input,
        requestId: `save-${++sequence}`,
        revision: active.snapshot.revision,
        texts,
      });
      if (session !== active) return;
      active.snapshot = snapshot;
      let current = false;
      try {
        currentContext();
        current = true;
      } catch {}
      if (current)
        await onSaved(active.input.subtitlePath, active.input.mediaPath);
      publish(
        "saved",
        current ? "已保存" : "字幕已保存；视频或字幕库已切换，未重新加载。",
      );
    } catch (error) {
      if (session === active)
        publish(
          "error",
          error.message || String(error),
          error.code || "subtitle.publishFailed",
        );
    }
  }

  function close() {
    if (session?.status === "saving") return;
    session = null;
    send({ status: "closed" });
    onChanged();
  }

  function seekCue(payload = {}) {
    if (
      !session ||
      session.id !== payload.sessionId ||
      session.input.mediaPath !== getContext().mediaPath
    )
      return;
    const cue = session.snapshot?.cues[payload.index];
    if (cue) seek(cue.start);
  }

  function register(sidebar) {
    sidebar.onMessage("editSubtitle", open);
    sidebar.onMessage("saveSubtitleEdits", save);
    sidebar.onMessage("closeSubtitleEditor", close);
    sidebar.onMessage("seekSubtitleCue", seekCue);
  }
  return {
    open,
    save,
    close,
    seekCue,
    register,
    isOpen: () => Boolean(session),
  };
}

module.exports = { createSubtitleEditorController };
