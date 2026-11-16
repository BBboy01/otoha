(() => {
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const dialog = make("dialog", "", "subtitle-association");
  const heading = make("h2", "关联已有字幕");
  heading.id = "association-heading";
  dialog.setAttribute("aria-labelledby", heading.id);
  const media = make("p", "", "association-media");
  const directory = make("p", "", "association-directory");
  const status = make("p", "", "association-status");
  status.setAttribute("role", "status");
  const list = make("div", "", "association-list");
  const selected = make("p", "", "association-selected");
  const actions = make("div", "", "association-actions");
  const back = make("button", "返回字幕库");
  const cancel = make("button", "取消");
  const confirm = make("button", "关联字幕");
  for (const button of [back, cancel, confirm]) button.type = "button";
  cancel.autofocus = true;
  actions.append(back, cancel, confirm);
  dialog.append(heading, media, directory, status, list, selected, actions);
  document.body.append(dialog);
  let state = { status: "closed" };
  let entriesKey = "";
  const post = (name, payload) => iina.postMessage(name, payload);
  back.addEventListener("click", () =>
    post("browseSubtitleAssociation", { directoryPath: "" }),
  );
  cancel.addEventListener("click", () => {
    if (state.status !== "copying") dialog.close();
  });
  confirm.addEventListener("click", () => post("confirmSubtitleAssociation"));
  dialog.addEventListener("cancel", (event) => {
    if (state.status === "copying") event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    dialog.returnValue = "";
    if (state.status !== "closed") post("cancelSubtitleAssociation");
  });
  iina.onMessage("association", (next) => {
    state = next;
    if (next.status === "closed") {
      if (dialog.open) dialog.close();
      return;
    }
    media.textContent = next.title || next.mediaPath?.split("/").pop() || "";
    directory.textContent = next.directoryPath?.split("/").pop() || "字幕库";
    status.textContent = next.message || "";
    const busy = ["copying", "loading"].includes(next.status);
    dialog.setAttribute("aria-busy", String(busy));
    cancel.disabled = next.status === "copying";
    back.hidden = !next.directoryPath;
    back.disabled = busy;
    confirm.hidden = !next.subtitlePath;
    confirm.disabled = busy;
    confirm.textContent = next.status === "copying" ? "正在关联" : "关联字幕";
    selected.textContent = next.subtitlePath
      ? `${next.subtitlePath.split("/").pop()} → ${media.textContent}`
      : "";
    selected.hidden = !next.subtitlePath;
    const nextEntriesKey = JSON.stringify(next.entries || []);
    if (entriesKey !== nextEntriesKey) {
      entriesKey = nextEntriesKey;
      list.replaceChildren();
      for (const entry of next.entries || []) {
        const button = make("button", "", "association-entry");
        button.type = "button";
        button.disabled = busy;
        const name = make("span", entry.name);
        const date = make(
          "time",
          Number.isFinite(entry.modifiedAt)
            ? new Date(entry.modifiedAt).toLocaleDateString()
            : "",
        );
        button.append(name, date);
        button.dataset.associationPath = entry.path;
        button.addEventListener("click", () =>
          post(
            entry.kind === "directory"
              ? "browseSubtitleAssociation"
              : "selectSubtitleAssociation",
            entry.kind === "directory"
              ? { directoryPath: entry.path }
              : { subtitlePath: entry.path },
          ),
        );
        list.append(button);
      }
    }
    for (const button of list.children) {
      button.disabled = busy;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.associationPath === next.subtitlePath),
      );
    }
    if (!dialog.open) dialog.showModal();
  });
  const trigger = document.getElementById("subtitle-associate");
  if (trigger)
    trigger.addEventListener("click", () => post("requestSubtitleAssociation"));
})();
