(() => {
  const node = (id) => document.getElementById(id);
  const generation = node("generation-options");
  const confirmation = node("regenerate-dialog");
  let state = {};
  let mediaPath;
  let pending = null;
  let hadSubtitles = false;
  let libraryResolved = false;
  function dismiss() {
    pending = null;
    if (confirmation.open) confirmation.close();
  }
  node("regenerate-cancel").addEventListener("click", dismiss);
  confirmation.addEventListener("cancel", dismiss);
  node("regenerate-confirm").addEventListener("click", () => {
    const start = pending;
    dismiss();
    if (start && !state.jobActive && !state.editorOpen) start();
  });
  const exportDialog = node("export-dialog");
  node("open-export").addEventListener("click", () => exportDialog.showModal());
  node("close-export").addEventListener("click", () => exportDialog.close());
  const menu = node("subtitle-more");
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); menu.open = false; menu.querySelector("summary").focus(); }
  });
  document.addEventListener?.("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  for (const id of ["delete-button", "reveal-button"]) {
    node(id).addEventListener("click", () => { menu.open = false; });
  }
  window.sidebarWorkflow = {
    subtitleLabel(subtitle, languages) {
      const filename = String(subtitle.path || "").split("/").pop();
      if (!subtitle.sourceLanguage || !subtitle.targetLanguage) return filename;
      const label = (language) => languages.find(([id]) => id === language)?.[1] || language;
      const version = filename.match(/ \((\d+)\)\.ass$/i)?.[1] || "1";
      return `${label(subtitle.sourceLanguage)} → ${label(subtitle.targetLanguage)} · 版本 ${version}`;
    },
    requestStart(payload, existing, start) {
      if (!existing) return start();
      pending = start;
      node("regenerate-description").textContent = "将生成一个新版本。现有字幕及人工校对会保留，可从字幕列表重新选择。";
      confirmation.showModal();
    },
    onState(next) {
      state = next;
      const path = next.media?.path || "";
      const hasSubtitles = Boolean(next.availableSubtitles?.length);
      if (path !== mediaPath) {
        libraryResolved = false;
        mediaPath = path;
        dismiss();
        if (exportDialog.open) exportDialog.close();
        menu.open = false;
      }
      if (!next.subtitleLibraryLoading && !libraryResolved) {
        generation.open = !hasSubtitles;
        libraryResolved = true;
      }
      if (hadSubtitles && !hasSubtitles) generation.open = true;
      hadSubtitles = hasSubtitles;
      node("generation-heading").textContent = hasSubtitles ? "重新生成" : "生成字幕";
      if (next.jobActive || next.editorOpen) dismiss();
      if (next.editorOpen) {
        if (exportDialog.open) exportDialog.close();
        menu.open = false;
      }
      node("open-export").disabled = node("export-button").disabled;
      const choice = node("subtitle-choice");
      const filename = String(choice.value || "").split("/").pop();
      node("subtitle-filename").textContent = filename;
      choice.title = filename;
    },
    onJob(job) {
      const running = ["running", "canceling", "loading"].includes(job.status);
      if (running) generation.open = false;
      node("job-edit").hidden = job.status !== "completed" || !job.jobId || !job.path || job.path !== node("subtitle-choice").value;
      node("job-edit").disabled = node("edit-subtitle-button").disabled;
    },
    onPreflight(check) {
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
