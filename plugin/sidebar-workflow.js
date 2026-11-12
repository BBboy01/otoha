(() => {
  const node = (id) => document.getElementById(id);
  const confirmation = node("regenerate-dialog");
  let state = {};
  let mediaPath;
  let pending = null;
  const confirmationMotion = window.createDialogMotion(confirmation, node("start-button"), () => dismiss());
  function dismiss(immediate = false) {
    pending = null;
    if (confirmation.open) confirmationMotion.close(immediate);
  }
  node("regenerate-cancel").addEventListener("click", () => dismiss());
  node("regenerate-confirm").addEventListener("click", () => {
    const start = pending;
    dismiss();
    if (start && !state.jobActive && !state.editorOpen) start();
  });
  const exportDialog = node("export-dialog");
  const exportMotion = window.createDialogMotion(exportDialog, node("open-export"), () => exportMotion.close());
  node("open-export").addEventListener("click", () => exportMotion.open());
  node("close-export").addEventListener("click", () => exportMotion.close());
  window.sidebarWorkflow = {
    subtitleLabel(subtitle) {
      const filename = String(subtitle.path || "").split("/").pop();
      if (!subtitle.sourceLanguage || !subtitle.targetLanguage) return filename;
      return this.subtitleVersion(subtitle);
    },
    subtitleVersion(subtitle) {
      if (!subtitle?.path) return "";
      const filename = String(subtitle.path).split("/").pop();
      const version = filename.match(/ \((\d+)\)\.ass$/i)?.[1];
      return version ? `版本 ${version}` : "版本 1";
    },
    requestStart(payload, existing, start) {
      if (!existing) return start();
      pending = start;
      node("regenerate-description").textContent = "将生成一个新版本。现有字幕及人工校对会保留，可从字幕列表重新选择。";
      confirmationMotion.open();
    },
    onState(next) {
      state = next;
      const path = next.media?.path || "";
      if (path !== mediaPath) {
        mediaPath = path;
        dismiss(true);
        if (exportDialog.open) exportMotion.close(true);
      }
      if (next.jobActive || next.editorOpen) dismiss(true);
      if (next.editorOpen) {
        if (exportDialog.open) exportMotion.close(true);
      }
      node("open-export").disabled = node("export-button").disabled;
      const choice = node("subtitle-choice");
      const filename = String(choice.value || "").split("/").pop();
      node("subtitle-filename").textContent = filename;
      choice.title = filename;
    },
    onJob(job) {
      node("job-edit").hidden = job.status !== "completed" || !job.jobId || !job.path || job.path !== node("subtitle-choice").value;
      node("job-edit").disabled = node("edit-subtitle-button").disabled;
    },
    onPreflight(check) {
      node("language-resource-status").setAttribute("data-status", check?.status || "checking");
      const speech = check?.speech;
      const translation = check?.translation;
      const translationMissing = check?.errorCode === "translation.resourcesMissing";
      const resourceLabel = (value) => ({ installed: "已就绪", supported: "生成时准备", downloading: "下载中", unsupported: "不支持" })[value] || "待检查";
      node("resource-breakdown").textContent = speech && translation
        ? `语音转录：${resourceLabel(speech)} · 翻译：${translationMissing ? "未安装" : resourceLabel(translation)}` : "";
      node("resource-help").hidden = !translationMissing;
    },
  };
  node("job-edit").addEventListener("click", () => node("edit-subtitle-button").click());
})();
