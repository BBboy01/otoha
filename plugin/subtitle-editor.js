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
    "editor-follow",
    "editor-follow-label",
    "editor-follow-tip",
    "editor-dirty",
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
  let preserveDraftOnClose = true;
  let composing = false;
  const draftSessions = new Map();
  const post = (name, payload) => iina.postMessage(name, payload);
  const dirty = () => JSON.stringify(drafts) !== JSON.stringify(baseline);
  const draftKey = (value) => [value.mediaPath, value.path, value.snapshot?.revision].join("\n");
  const time = (seconds) => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, "0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, "0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
  };
  const cueList = window.createSubtitleCueList({
    viewport: nodes.cue,
    count: nodes.count,
    videoMarker: document.getElementById("editor-video-marker"),
    onSelect: selectCue,
    onSeek: seek,
  });
  nodes.follow.checked = true;
  const navigate = window.createSidebarNavigation(document.getElementById("sidebar-home"), nodes["subtitle-editor"]);
  const discardMotion = window.createDialogMotion(nodes["discard-dialog"], nodes.close, () => discardMotion.close());
  function seek(position = index) {
    if (!session || session.status === "saving" || currentMedia !== session.mediaPath) return;
    post("seekSubtitleCue", { sessionId: session.sessionId, index: position });
    cueList.setVideoIndex(position, true);
  }
  function selectCue(position) {
    if (session?.status === "saving" || position < 0 || position >= drafts.length || position === index) return;
    index = position;
    showCue(true);
    if (nodes.follow.checked) seek();
  }
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
    for (const field of [nodes.source, nodes.translation])
      field.disabled = saving;
    cueList.setDisabled(saving);
    nodes.previous.disabled = saving || index === 0;
    nodes.next.disabled = saving || index >= drafts.length - 1;
    nodes.follow.disabled = !available || saving || detached;
    nodes.save.disabled = !available || saving || detached || !dirty();
    nodes["save-next"].disabled = !available || saving || detached || index >= drafts.length - 1;
    nodes.dirty.hidden = !dirty();
    if (available) cueList.update(index, drafts[index], JSON.stringify(drafts[index]) !== JSON.stringify(baseline[index]), composing);
    const status = saving
      ? "正在保存字幕"
      : detached
        ? "视频已切换，草稿已保留"
        : session.message || "";
    if (nodes.status.textContent !== status) nodes.status.textContent = status;
    const error = session.status === "error" ? session.message : "";
    if (nodes.error.textContent !== error) nodes.error.textContent = error;
    nodes.error.hidden = !nodes.error.textContent;
  }
  function showCue(animate = false) {
    const cue = session?.snapshot?.cues[index];
    if (!cue) return;
    cueList.select(index, Boolean(animate));
    nodes.source.value = drafts[index].source;
    nodes.translation.value = drafts[index].translation;
    nodes.time.textContent = `${time(cue.start)} – ${time(cue.end)}`;
    render();
  }
  function close(discard = false) {
    if (session?.status === "saving") return;
    preserveDraftOnClose = !discard;
    if (discard && session) draftSessions.delete(draftKey(session));
    if (nodes["discard-dialog"].open) discardMotion.close(true);
    post("closeSubtitleEditor");
  }
  function requestClose() {
    if (session?.status === "saving") return;
    if (dirty()) discardMotion.open();
    else close();
  }
  function save(advance = false) {
    if (advance && nodes["save-next"].disabled) return;
    if (advance && !dirty()) { selectCue(index + 1); nodes.source.focus(); return; }
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
      if (session && preserveDraftOnClose && session.snapshot) {
        draftSessions.set(draftKey(session), {
          drafts:drafts.map((draft) => ({ ...draft })),
          index,
          scrollTop:nodes.fields.scrollTop,
        });
      }
      session = null;
      baseline = [];
      drafts = [];
      advanceAfterSave = false;
      if (nodes["discard-dialog"].open) discardMotion.close(true);
      navigate(false);
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
      cueList.setVideoIndex(-1, false);
      baseline = [];
      drafts = [];
      index = 0;
      advanceAfterSave = false;
      preserveDraftOnClose = true;
      restoreFocus = document.activeElement;
      nodes.file.textContent = next.path?.split("/").pop() || "";
      navigate(true);
      nodes.close.focus();
    }
    if (next.status === "error") advanceAfterSave = false;
    if (next.snapshot && (next.status === "ready" || next.status === "saved")) {
      const initialSnapshot = !drafts.length;
      const key = draftKey(next);
      const cached = draftSessions.get(key);
      draftSessions.delete(key);
      baseline = next.snapshot.cues.map(({ source, translation }) => ({
        source,
        translation,
      }));
      drafts = cached?.drafts.length === baseline.length
        ? cached.drafts.map((draft) => ({ ...draft }))
        : baseline.map((text) => ({ ...text }));
      index = Math.min(cached?.index ?? index, drafts.length - 1);
      nodes.fields.scrollTop = cached?.scrollTop || 0;
      cueList.replace(next.snapshot.cues, drafts, baseline, next.status === "saved");
      const advance = next.status === "saved" && advanceAfterSave;
      if (next.status === "saved") draftSessions.delete(draftKey(next));
      if (advance) {
        index = Math.min(index + 1, drafts.length - 1);
        advanceAfterSave = false;
      }
      showCue(advance);
      if (nodes.follow.checked && (fresh || initialSnapshot || advance)) seek();
      if (next.status === "ready" || advance) nodes.source.focus();
    }
    render();
  });
  for (const field of [nodes.source, nodes.translation]) {
    field.addEventListener("compositionstart", () => { composing = true; });
    field.addEventListener("compositionend", () => { composing = false; render(); });
    field.addEventListener("input", () => {
      if (!drafts[index]) return;
      drafts[index] = {
        source: nodes.source.value,
        translation: nodes.translation.value,
      };
      render();
    });
  }
  nodes.previous.addEventListener("click", () => selectCue(index - 1));
  nodes.next.addEventListener("click", () => selectCue(index + 1));
  nodes.follow.addEventListener("change", () => {
    cueList.setFollow(nodes.follow.checked);
    if (nodes.follow.checked) seek();
  });
  nodes["follow-tip"].hidden = true;
  for (const name of ["mouseenter", "mouseleave"]) nodes["follow-label"].addEventListener(name, () => {
    nodes["follow-tip"].hidden = name === "mouseleave";
  });
  for (const name of ["focus", "blur"]) nodes.follow.addEventListener(name, () => {
    nodes["follow-tip"].hidden = name === "blur";
  });
  nodes.follow.addEventListener("keydown", event => {
    if (event.key !== "Escape" || nodes["follow-tip"].hidden) return;
    nodes["follow-tip"].hidden = true;
    event.preventDefault();
    event.stopPropagation();
  });
  nodes.save.addEventListener("click", () => save());
  nodes["save-next"].addEventListener("click", () => save(true));
  nodes.close.addEventListener("click", requestClose);
  nodes.keep.addEventListener("click", () => discardMotion.close());
  nodes.discard.addEventListener("click", () => close(true));
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
