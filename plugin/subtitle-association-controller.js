const { PROTOCOL_VERSION } = require("./protocol.js");

function createSubtitleAssociationController({
  getContext,
  send,
  exec,
  onChanged,
  onAssociated,
}) {
  let session = null;
  let sequence = 0;
  function publish(status, message = "") {
    if (!session) return;
    session.status = status;
    send({ ...session, message });
    onChanged();
  }
  function validContext(active) {
    const context = getContext();
    if (
      context.busy ||
      context.mediaPath !== active.mediaPath ||
      context.outputDirectoryPath !== active.outputDirectoryPath
    )
      throw new Error("视频或字幕库已切换，请关闭后重新选择字幕。");
    if (!context.helperPath) throw new Error("字幕工具尚未就绪。");
    return context;
  }
  async function request(command, active, extra) {
    const context = validContext(active);
    const requestId = `associate-${Date.now()}-${++sequence}`;
    const result = await exec(context.helperPath, [
      command,
      JSON.stringify({
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        mediaPath: active.mediaPath,
        outputDirectoryPath: active.outputDirectoryPath,
        ...extra,
      }),
    ]);
    if (!result || result.status !== 0)
      throw new Error("字幕工具运行失败，请重试。");
    const response = JSON.parse(result.stdout);
    if (
      response.protocolVersion !== PROTOCOL_VERSION ||
      response.requestId !== requestId
    )
      throw new Error("字幕工具返回无效响应。");
    if (response.code) throw new Error(response.message || "关联字幕失败。");
    return response;
  }
  async function browse(payload = {}) {
    if (!session || session.status === "copying") return;
    const active = session;
    const operation = ++sequence;
    active.operation = operation;
    const directoryPath = payload.directoryPath || "";
    if (
      directoryPath &&
      !active.entries.some(
        (entry) => entry.kind === "directory" && entry.path === directoryPath,
      )
    )
      return;
    active.directoryPath = directoryPath;
    active.subtitlePath = "";
    publish("loading", "正在读取字幕库");
    try {
      const response = await request("--browse-subtitles-json", active, {
        directoryPath,
      });
      if (session !== active || active.operation !== operation) return;
      validContext(active);
      if (
        !Array.isArray(response.entries) ||
        response.entries.some(
          (entry) =>
            !entry ||
            typeof entry.path !== "string" ||
            !entry.path.startsWith("/") ||
            typeof entry.name !== "string" ||
            !["directory", "subtitle"].includes(entry.kind),
        )
      )
        throw new Error("字幕工具返回无效列表。");
      active.entries = response.entries;
      publish("browse", response.entries.length ? "" : "没有可关联的字幕");
    } catch (error) {
      if (session === active && active.operation === operation)
        publish("error", error.message);
    }
  }
  async function open() {
    const context = getContext();
    if (session || context.busy || !context.mediaPath) return;
    session = {
      mediaPath: context.mediaPath,
      outputDirectoryPath: context.outputDirectoryPath,
      title: context.title,
      entries: [],
      directoryPath: "",
      subtitlePath: "",
    };
    await browse();
  }
  function select(payload = {}) {
    if (!session || !["browse", "confirm", "error"].includes(session.status))
      return;
    if (
      !session.entries.some(
        (entry) =>
          entry.kind === "subtitle" && entry.path === payload.subtitlePath,
      )
    )
      return;
    session.subtitlePath = payload.subtitlePath;
    publish("confirm");
  }
  function cancel() {
    if (session?.status === "copying") return;
    session = null;
    send({ status: "closed" });
    onChanged();
  }
  async function confirm() {
    if (
      !session?.subtitlePath ||
      !["confirm", "error"].includes(session.status)
    )
      return;
    const active = session;
    try {
      validContext(active);
      publish("copying", "正在关联字幕");
      const response = await request("--associate-subtitle-json", active, {
        subtitlePath: active.subtitlePath,
      });
      if (session !== active) return;
      if (
        typeof response.path !== "string" ||
        !response.path.startsWith("/") ||
        !response.path.toLowerCase().endsWith(".ass")
      )
        throw new Error("字幕工具返回无效路径。");
      await onAssociated(
        response.path,
        active.mediaPath,
        active.outputDirectoryPath,
      );
      session = null;
      send({ status: "closed" });
      onChanged();
    } catch (error) {
      if (session === active) publish("error", error.message);
    }
  }
  function register(sidebar) {
    sidebar.onMessage("requestSubtitleAssociation", open);
    sidebar.onMessage("browseSubtitleAssociation", browse);
    sidebar.onMessage("selectSubtitleAssociation", select);
    sidebar.onMessage("confirmSubtitleAssociation", confirm);
    sidebar.onMessage("cancelSubtitleAssociation", cancel);
  }
  return {
    open,
    browse,
    select,
    confirm,
    cancel,
    register,
    isOpen: () => Boolean(session),
  };
}
module.exports = { createSubtitleAssociationController };
