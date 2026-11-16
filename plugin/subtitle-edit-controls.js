window.createSubtitleEditControls = function (api) {
  const tools = window.subtitleEditTools;
  const disclosure = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "校对工具";
  disclosure.append(summary);
  const root = document.createElement("section");
  root.className = "editor-extra-controls";
  root.setAttribute("aria-label", "校对工具");
  disclosure.append(root);
  api.container.prepend(disclosure);
  const group = (title) => {
    const section = document.createElement("fieldset");
    section.className = "editor-tool-group";
    const legend = document.createElement("legend");
    legend.textContent = title;
    section.append(legend);
    root.append(section);
    return section;
  };
  let target = root;
  const field = (name, type = "text") => {
    const label = document.createElement("label");
    label.textContent = name;
    if (type === "checkbox") label.className = "editor-toggle";
    const input = document.createElement("input");
    input.type = type;
    input.setAttribute("aria-label", name);
    input.name = name;
    label.append(input);
    target.append(label);
    return input;
  };
  const button = (title, action) => {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = title;
    node.addEventListener("click", () => {
      try {
        action();
        error.textContent = "";
      } catch (cause) {
        error.textContent = cause.message;
      }
    });
    target.append(node);
    return node;
  };
  const error = document.createElement("p");
  error.setAttribute("role", "status");
  root.append(error);
  const undo = api.undoButton;
  undo.addEventListener("click", () => {
    if (!undo.disabled) api.undo();
  });
  target = group("查找与替换");
  const query = field("查找", "search"),
    replacement = field("替换为");
  const scope = document.createElement("select");
  scope.id = "editor-search-scope";
  scope.setAttribute("aria-label", "查找范围");
  for (const [value, text] of [
    ["both", "原文和译文"],
    ["source", "原文"],
    ["translation", "译文"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    scope.append(option);
  }
  const scopeLabel = document.createElement("label");
  scopeLabel.className = "editor-tool-wide";
  scopeLabel.textContent = "查找范围";
  scopeLabel.append(scope);
  target.append(scopeLabel);
  const result = document.createElement("output");
  target.append(result);
  let matches = [],
    matchIndex = -1;
  function find() {
    matches = tools.search(api.getCues(), query.value, scope.value);
    result.textContent = `${matches.length} 处`;
  }
  query.addEventListener("input", () => {
    matchIndex = -1;
    replaceAll.dataset.confirm = "";
    replaceAll.textContent = "全部替换";
    find();
  });
  scope.addEventListener("change", () => {
    matchIndex = -1;
    replaceAll.dataset.confirm = "";
    replaceAll.textContent = "全部替换";
    find();
  });
  button("下一处", () => {
    find();
    if (matches.length) {
      matchIndex = (matchIndex + 1) % matches.length;
      const match = matches[matchIndex];
      api.select(match.index, { ...match, length: query.value.length });
    }
  });
  button("替换当前", () => {
    api.change(
      tools.replace(
        api.getCues(),
        query.value,
        replacement.value,
        scope.value,
        false,
        matches[matchIndex]?.index === api.getIndex()
          ? matches[matchIndex]
          : api.getIndex(),
      ),
    );
    find();
  });
  const replaceAll = button("全部替换", () => {
    find();
    if (!matches.length) return;
    if (replaceAll.dataset.confirm !== "yes") {
      replaceAll.dataset.confirm = "yes";
      replaceAll.textContent = `确认替换 ${matches.length} 处`;
      return;
    }
    api.change(
      tools.replace(
        api.getCues(),
        query.value,
        replacement.value,
        scope.value,
        true,
      ),
    );
    replaceAll.dataset.confirm = "";
    replaceAll.textContent = "全部替换";
    find();
  });
  replaceAll.className = "editor-tool-wide";
  target = group("时间与播放");
  const start = field("开始时间（秒）", "number"),
    end = field("结束时间（秒）", "number");
  for (const input of [start, end]) {
    input.min = "0";
    input.step = "0.01";
  }
  button("应用时间", () => {
    const cues = api.getCues().map((cue) => ({ ...cue })),
      cue = cues[api.getIndex()];
    const a = Number(start.value),
      b = Number(end.value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a)
      throw Error("结束时间必须晚于非负的开始时间。");
    cue.start = a;
    cue.end = b;
    api.change(cues);
  });
  const loop = field("循环当前句", "checkbox");
  loop.addEventListener("change", () => api.loop(loop.checked));
  target = group("合并与拆分");
  button("合并下一句", () =>
    api.change(tools.merge(api.getCues(), api.getIndex())),
  ).className = "editor-tool-wide";
  const sourceAt = field("原文切分位置", "number"),
    translationAt = field("译文切分位置", "number"),
    splitTime = field("拆分时间（秒）", "number");
  for (const input of [sourceAt, translationAt]) {
    input.min = "1";
    input.step = "1";
  }
  splitTime.min = "0";
  splitTime.step = "0.01";
  let awaitingPlayback = false;
  function refreshPlayback() {
    awaitingPlayback = Boolean(disclosure.open);
    if (awaitingPlayback) api.refreshPlayback();
  }
  function splitPosition(playback) {
    const cue = api.getCues()[api.getIndex()],
      position = playback?.position;
    if (!cue) return "";
    return Number.isFinite(position) &&
      position > cue.start &&
      position < cue.end
      ? position
      : (cue.start + cue.end) / 2;
  }
  disclosure.addEventListener("toggle", refreshPlayback);
  splitTime.addEventListener("input", () => {
    awaitingPlayback = false;
  });
  button("拆分当前句", () =>
    api.change(
      tools.split(
        api.getCues(),
        api.getIndex(),
        Number(sourceAt.value),
        Number(translationAt.value),
        Number(splitTime.value),
      ),
    ),
  ).className = "editor-tool-wide";
  target = group("草稿与历史");
  const restoreDraft = button("恢复草稿", api.restoreDraft),
    discard = button("丢弃草稿", api.discardDraft);
  const history = document.createElement("select");
  history.id = "editor-history-version";
  history.setAttribute("aria-label", "保存前版本");
  const historyLabel = document.createElement("label");
  historyLabel.className = "editor-tool-wide";
  historyLabel.textContent = "保存前版本";
  historyLabel.append(history);
  target.append(historyLabel);
  button("恢复所选版本", () => {
    if (history.value) api.restore(history.value);
  }).className = "editor-tool-wide";
  let lastCue = "",
    lastRevision = "",
    lastSession = null;
  return {
    updatePlayback(playback) {
      if (!awaitingPlayback || !disclosure.open) return;
      awaitingPlayback = false;
      splitTime.value = splitPosition(playback);
    },
    render({ session, undo: count, disabled, looping, unresolvedDraft }) {
      if (lastSession !== session.sessionId) {
        lastSession = session.sessionId;
        disclosure.open = false;
        awaitingPlayback = false;
      }
      for (const control of root.querySelectorAll("input,select,button"))
        control.disabled = disabled || unresolvedDraft;
      undo.disabled = disabled || unresolvedDraft || !count;
      loop.checked = Boolean(looping);
      const cue = api.getCues()[api.getIndex()];
      const key = cue ? `${cue.id}:${cue.start}:${cue.end}` : "";
      if (key !== lastCue) {
        lastCue = key;
        start.value = cue?.start ?? "";
        end.value = cue?.end ?? "";
        splitTime.value = splitPosition(window.subtitleEditorPlayback);
        refreshPlayback();
      }
      translationAt.parentElement.hidden = session.snapshot?.mode === "source";
      const draft = session.snapshot?.draft;
      restoreDraft.hidden = !draft;
      discard.hidden = !draft;
      restoreDraft.disabled =
        disabled || draft?.revision !== session.snapshot?.revision;
      discard.disabled = disabled;
      if (draft && draft.revision !== session.snapshot.revision)
        error.textContent = "字幕已改变，旧草稿已保留，无法直接恢复覆盖。";
      if (lastRevision !== session.snapshot?.revision) {
        lastRevision = session.snapshot?.revision;
        history.replaceChildren();
        for (const item of session.snapshot?.history || []) {
          const option = document.createElement("option");
          option.value = item.id;
          option.textContent = new Date(item.modified * 1000).toLocaleString();
          history.append(option);
        }
      }
    },
  };
};
