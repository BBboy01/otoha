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
  const post = (name, payload) => iina.postMessage(name, payload);
  const dirty = () => JSON.stringify(drafts) !== JSON.stringify(baseline);
  const time = (seconds) => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  function render() {
    if (!session) return;
    const saving = session.status === "saving";
    const detached =
      Boolean(currentMedia && currentMedia !== session.mediaPath) ||
      !currentMedia;
    const available = drafts.length > 0;
    nodes.fields.hidden = !available;
    nodes.close.disabled = saving;
    for (const field of [nodes.source, nodes.translation, nodes.cue])
      field.disabled = saving;
    nodes.previous.disabled = saving || index === 0;
    nodes.next.disabled = saving || index >= drafts.length - 1;
    nodes.seek.disabled = !available || saving || detached;
    nodes.save.disabled = !available || saving || detached || !dirty();
    nodes.status.textContent = saving
      ? "正在保存字幕"
      : detached
        ? "视频已切换，草稿已保留"
        : dirty()
          ? "未保存"
          : session.message || "";
    nodes.error.textContent = session.status === "error" ? session.message : "";
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
  function save() {
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
      if (nodes["discard-dialog"].open) nodes["discard-dialog"].close();
      nodes["subtitle-editor"].close();
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
      restoreFocus = document.activeElement;
      nodes.file.textContent = next.path?.split("/").pop() || "";
      if (!nodes["subtitle-editor"].open) nodes["subtitle-editor"].showModal();
    }
    if (next.snapshot && (next.status === "ready" || next.status === "saved")) {
      baseline = next.snapshot.cues.map(({ source, translation }) => ({
        source,
        translation,
      }));
      drafts = baseline.map((text) => ({ ...text }));
      nodes.cue.replaceChildren(
        ...next.snapshot.cues.map(
          (cue, cueIndex) =>
            new Option(
              `${cueIndex + 1}. ${time(cue.start)}  ${cue.source.replace(/\n/g, " ").slice(0, 60)}`,
              String(cueIndex),
            ),
        ),
      );
      showCue();
      if (next.status === "ready") nodes.source.focus();
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
  nodes.save.addEventListener("click", save);
  nodes.close.addEventListener("click", requestClose);
  nodes.keep.addEventListener("click", () => nodes["discard-dialog"].close());
  nodes.discard.addEventListener("click", close);
  nodes["subtitle-editor"].addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  nodes["subtitle-editor"].addEventListener("keydown", (event) => {
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
