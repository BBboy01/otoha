(() => {
  const dialog = document.querySelector("#delete-dialog");
  const trigger = document.querySelector("#delete-button");
  const cancel = document.querySelector("#delete-cancel");
  const confirm = document.querySelector("#delete-confirm");
  const description = document.querySelector("#delete-description");
  const message = document.querySelector("#delete-error");
  let requestId = "";
  let deleting = false;
  trigger.addEventListener("click", () => iina.postMessage("requestSubtitleDeletion", document.querySelector("#subtitle-choice").value));
  cancel.addEventListener("click", () => iina.postMessage("cancelSubtitleDeletion"));
  confirm.addEventListener("click", () => iina.postMessage("confirmSubtitleDeletion", { requestId }));
  dialog.addEventListener("cancel", event => { event.preventDefault(); if (!deleting) iina.postMessage("cancelSubtitleDeletion"); });
  iina.onMessage("deletion", payload => {
    if (["closed", "deleted"].includes(payload.status)) {
      dialog.close();
      const focusTarget = trigger.disabled || document.querySelector("#existing-subtitles").hidden ? document.querySelector("#source-language") : trigger;
      focusTarget.focus();
      return;
    }
    requestId = payload.requestId;
    deleting = payload.status === "deleting";
    description.textContent = `${payload.title || payload.mediaPath.split("/").pop()} · ${payload.sourceLanguage || "未知"} → ${payload.targetLanguage || "未知"}。删除后无法撤销；正在使用的对应轨道将从播放器卸载。`;
    message.textContent = payload.message || "";
    message.hidden = !payload.message;
    confirm.disabled = deleting; cancel.disabled = deleting;
    confirm.textContent = deleting ? "正在删除" : "删除";
    if (!dialog.open) { dialog.showModal(); cancel.focus(); }
  });
})();
