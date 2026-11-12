window.createDialogMotion = (dialog, trigger, onDismiss) => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let effect,
    revision = 0,
    closing = false,
    backdropPressed = false;
  function origin(style) {
    const bounds = dialog.getBoundingClientRect();
    const matrix = new DOMMatrix(
      style.transform === "none" ? undefined : style.transform,
    );
    const anchor = trigger.getBoundingClientRect();
    return {
      transform: `translate(${anchor.x + anchor.width / 2 - bounds.x + matrix.m41 - bounds.width / 2}px,${anchor.y + anchor.height / 2 - bounds.y + matrix.m42 - bounds.height / 2}px)`,
      clipPath: `inset(${Math.max(0, (bounds.height - anchor.height) / 2)}px ${Math.max(0, (bounds.width - anchor.width) / 2)}px round ${style.borderRadius})`,
      opacity: 0,
    };
  }
  function timing(style) {
    return {
      duration: parseFloat(
        style.getPropertyValue("--otoha-motion-duration-dialog"),
      ),
      easing: style.getPropertyValue("--otoha-motion-ease-standard").trim(),
      fill: "both",
    };
  }
  const motion = {
    open() {
      if (dialog.open && !closing) return;
      revision++;
      effect?.cancel();
      closing = false;
      dialog.inert = false;
      dialog.dataset.motion = "open";
      if (!dialog.open) dialog.showModal();
      if (reduced.matches) return;
      const style = window.getComputedStyle(dialog);
      effect = dialog.animate(
        [
          origin(style),
          {
            transform: "translate(0,0)",
            clipPath: `inset(0 round ${style.borderRadius})`,
            opacity: 1,
          },
        ],
        timing(style),
      );
    },
    async close(immediate = false) {
      if (!dialog.open || (closing && !immediate)) return;
      const token = ++revision;
      closing = true;
      dialog.inert = true;
      dialog.dataset.motion = "closing";
      if (!immediate && !reduced.matches) {
        const style = window.getComputedStyle(dialog);
        const current = {
          transform: style.transform,
          clipPath: style.clipPath,
          opacity: style.opacity,
        };
        const target = origin(style);
        effect?.cancel();
        effect = dialog.animate([current, target], timing(style));
        await effect.finished.catch(() => {});
      }
      if (revision !== token) return;
      dialog.close();
      effect?.cancel();
      effect = undefined;
      closing = false;
      dialog.inert = false;
    },
  };
  function isBackdrop(event) {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  dialog.addEventListener("pointerdown", (event) => {
    backdropPressed = event.button === 0 && isBackdrop(event);
  });
  dialog.addEventListener("pointercancel", () => {
    backdropPressed = false;
  });
  dialog.addEventListener("click", (event) => {
    if (backdropPressed && isBackdrop(event) && !closing) onDismiss();
    backdropPressed = false;
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (!closing) onDismiss();
  });
  return motion;
};
