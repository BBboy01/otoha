const { PROTOCOL_VERSION } = require("./protocol.js");

function createSubtitleDeletionController({ getContext, send, onChanged, onDeleted, exec }) {
  let pending = null;
  let sequence = 0;
  function publish(status, message = "") {
    if (!pending) return;
    pending.status = status;
    send({ ...pending, message }); onChanged();
  }
  function open(path) {
    if (pending) return;
    const context = getContext();
    const selected = context.files.find(item => item.path === path);
    if (context.busy || !context.mediaPath || !selected) return;
    pending = { requestId: `delete-${Date.now()}-${++sequence}`, path, mediaPath: context.mediaPath,
      outputDirectoryPath: context.outputDirectoryPath, title: context.title,
      sourceLanguage: selected.sourceLanguage || "", targetLanguage: selected.targetLanguage || "" };
    publish("confirm");
  }
  function cancel() {
    if (pending?.status === "deleting") return;
    pending = null; send({ status: "closed" }); onChanged();
  }
  async function confirm(payload = {}) {
    if (!pending || payload.requestId !== pending.requestId || pending.status === "deleting") return;
    const active = pending;
    const context = getContext();
    try {
      if (context.busy || context.mediaPath !== active.mediaPath || context.outputDirectoryPath !== active.outputDirectoryPath
        || !context.files.some(item => item.path === active.path)) throw new Error("视频或字幕库已切换。请取消后重新选择字幕。");
      if (!context.helperPath) throw new Error("字幕工具尚未就绪，请重新打开侧栏。");
      publish("deleting", "正在删除字幕");
      const request = { protocolVersion: PROTOCOL_VERSION, requestId: active.requestId, mediaPath: active.mediaPath,
        subtitlePath: active.path, outputDirectoryPath: active.outputDirectoryPath };
      const result = await exec(context.helperPath, ["--delete-subtitle-json", JSON.stringify(request)]);
      if (!result || result.status !== 0) throw new Error("字幕工具运行失败，请重试。");
      const response = JSON.parse(result.stdout);
      if (response.protocolVersion !== PROTOCOL_VERSION || response.requestId !== active.requestId) throw new Error("字幕工具返回无效响应。");
      if (response.code) throw new Error(response.message || "字幕删除失败，请检查目录权限。");
      if (response.path !== active.path) throw new Error("字幕工具返回无效路径。");
      await onDeleted(active.path, active.mediaPath, active.outputDirectoryPath);
      publish("deleted", "字幕已删除");
      pending = null; onChanged();
    } catch (error) { if (pending === active) publish("error", error.message || String(error)); }
  }
  function register(sidebar) {
    sidebar.onMessage("requestSubtitleDeletion", open);
    sidebar.onMessage("confirmSubtitleDeletion", confirm);
    sidebar.onMessage("cancelSubtitleDeletion", cancel);
  }
  return { open, cancel, confirm, register, isOpen: () => Boolean(pending) };
}
module.exports = { createSubtitleDeletionController };
