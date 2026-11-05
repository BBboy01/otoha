(() => {
  const ids = [
    "subtitle-editor",
    "editor-discard-dialog",
    "editor-heading",
    "editor-close",
    "editor-file",
    "editor-status",
    "editor-error",
    "editor-fields",
    "editor-cue",
    "editor-previous",
    "editor-next",
    "editor-time",
    "editor-seek",
    "editor-source",
    "editor-translation",
    "editor-save",
    "editor-save-next",
    "editor-save-area",
    "editor-count",
    "editor-keep",
    "editor-discard",
  ];
  const nodes = Object.fromEntries(
    ids.map((id) => [id.replace(/^editor-/, ""), document.getElementById(id)]),
  );
  let session = null;
  let baseline = [];
  let drafts = [];
  let index = 0;
  let currentMedia = "";
  let restoreFocus = null;
  let advanceAfterSave = false;
  const post = (name, payload) => iina.postMessage(name, payload);
  const dirty = () => JSON.stringify(drafts) !== JSON.stringify(baseline);
  const time = (seconds) => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  const cueLabel = (cueIndex) => {
    const cue = session.snapshot.cues[cueIndex];
    const modified = JSON.stringify(drafts[cueIndex]) !== JSON.stringify(baseline[cueIndex]);
    return `${cueIndex + 1}. ${time(cue.start)} ${modified ? "[未保存] " : ""}${drafts[cueIndex].source.replace(/\n/g, " ").slice(0, 60)}`;
  };
  function render() {
    if (!session) return;
    const saving = session.status === "saving";
    const detached =
      Boolean(currentMedia && currentMedia !== session.mediaPath) ||
      !currentMedia;
    const available = drafts.length > 0;
    nodes.fields.hidden = !available;
    nodes["save-area"].hidden = !available;
    nodes.close.disabled = saving;
    for (const field of [nodes.source, nodes.translation, nodes.cue])
      field.disabled = saving;
    nodes.previous.disabled = saving || index === 0;
    nodes.next.disabled = saving || index >= drafts.length - 1;
    nodes.seek.disabled = !available || saving || detached;
    nodes.save.disabled = !available || saving || detached || !dirty();
    nodes["save-next"].disabled = !available || saving || detached || index >= drafts.length - 1;
    const count = available ? `第 ${index + 1} / ${drafts.length} 句` : "";
    if (nodes.count.textContent !== count) nodes.count.textContent = count;
    if (nodes.cue.children[index]) nodes.cue.children[index].text = cueLabel(index);
    const status = saving
      ? "正在保存字幕"
      : detached
        ? "视频已切换，草稿已保留"
        : dirty()
          ? "未保存"
          : session.message || "";
    if (nodes.status.textContent !== status) nodes.status.textContent = status;
    const error = session.status === "error" ? session.message : "";
    if (nodes.error.textContent !== error) nodes.error.textContent = error;
    nodes.error.hidden = !nodes.error.textContent;
  }
  function showCue() {
    const cue = session?.snapshot?.cues[index];
    if (!cue) return;
    nodes.cue.value = String(index);
    nodes.source.value = drafts[index].source;
    nodes.translation.value = drafts[index].translation;
    nodes.time.textContent = `${time(cue.start)} – ${time(cue.end)}`;
    render();
  }
  function close() {
    if (session?.status === "saving") return;
    if (nodes["discard-dialog"].open) nodes["discard-dialog"].close();
    post("closeSubtitleEditor");
  }
  function requestClose() {
    if (session?.status === "saving") return;
    if (dirty()) nodes["discard-dialog"].showModal();
    else close();
  }
  function save(advance = false) {
    if (advance && nodes["save-next"].disabled) return;
    if (advance && !dirty()) { index++; showCue(); nodes.source.focus(); return; }
    if (nodes.save.disabled) return;
    const invalid = drafts.findIndex(
      (text) => !text.source.trim() || !text.translation.trim(),
    );
    if (invalid >= 0) {
      index = invalid;
      showCue();
      session = {
        ...session,
        status: "error",
        message: "每句字幕都需要原文和译文。",
      };
      render();
      (drafts[index].source.trim() ? nodes.translation : nodes.source).focus();
      return;
    }
    advanceAfterSave = advance;
    session = { ...session, status: "saving" };
    render();
    post("saveSubtitleEdits", {
      sessionId: session.sessionId,
      texts: drafts.map((text) => ({ ...text })),
    });
  }
  iina.onMessage("editor", (next) => {
    if (next.status === "closed") {
      session = null;
      baseline = [];
      drafts = [];
      advanceAfterSave = false;
      if (nodes["discard-dialog"].open) nodes["discard-dialog"].close();
      nodes["subtitle-editor"].hidden = true;
      document.getElementById("sidebar-home").hidden = false;
      if (
        restoreFocus &&
        !restoreFocus.disabled &&
        restoreFocus.getClientRects().length
      )
        restoreFocus.focus();
      else {
        const mediaName = document.getElementById("media-name");
        mediaName.tabIndex = -1;
        mediaName.focus();
      }
      return;
    }
    const fresh = session?.sessionId !== next.sessionId;
    session = { ...session, ...next };
    if (fresh) {
      baseline = [];
      drafts = [];
      index = 0;
      advanceAfterSave = false;
      restoreFocus = document.activeElement;
      nodes.file.textContent = next.path?.split("/").pop() || "";
      document.getElementById("sidebar-home").hidden = true;
      nodes["subtitle-editor"].hidden = false;
      nodes.close.focus();
    }
    if (next.status === "error") advanceAfterSave = false;
    if (next.snapshot && (next.status === "ready" || next.status === "saved")) {
      baseline = next.snapshot.cues.map(({ source, translation }) => ({
        source,
        translation,
      }));
      drafts = baseline.map((text) => ({ ...text }));
      nodes.cue.replaceChildren(
        ...next.snapshot.cues.map((cue, cueIndex) => new Option(cueLabel(cueIndex), String(cueIndex))),
      );
      const advance = next.status === "saved" && advanceAfterSave;
      if (advance) {
        index = Math.min(index + 1, drafts.length - 1);
        advanceAfterSave = false;
      }
      showCue();
      if (next.status === "ready" || advance) nodes.source.focus();
    }
    render();
  });
  for (const field of [nodes.source, nodes.translation])
    field.addEventListener("input", () => {
      if (!drafts[index]) return;
      drafts[index] = {
        source: nodes.source.value,
        translation: nodes.translation.value,
      };
      render();
    });
  nodes.cue.addEventListener("change", () => {
    index = Number(nodes.cue.value);
    showCue();
  });
  nodes.previous.addEventListener("click", () => {
    if (index > 0) {
      index--;
      showCue();
    }
  });
  nodes.next.addEventListener("click", () => {
    if (index < drafts.length - 1) {
      index++;
      showCue();
    }
  });
  nodes.seek.addEventListener("click", () =>
    post("seekSubtitleCue", { sessionId: session.sessionId, index }),
  );
  nodes.save.addEventListener("click", () => save());
  nodes["save-next"].addEventListener("click", () => save(true));
  nodes.close.addEventListener("click", requestClose);
  nodes.keep.addEventListener("click", () => nodes["discard-dialog"].close());
  nodes.discard.addEventListener("click", close);
  nodes["subtitle-editor"].addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  nodes["subtitle-editor"].addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !nodes["discard-dialog"].open) {
      event.preventDefault();
      requestClose();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.subtitleEditorUI = {
    onState: (state) => {
      currentMedia = state.media?.path || "";
      render();
    },
  };
})();
