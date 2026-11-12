window.createSidebarNavigation = (home, editor) => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let opened = false,
    revision = 0,
    effects = [];
  return (next) => {
    if (opened === next) return;
    const currentRevision = ++revision;
    const starts = [home, editor].map((node) =>
      node.hidden ? null : window.getComputedStyle(node).transform,
    );
    effects.forEach((effect) => effect.cancel());
    effects = [];
    opened = next;
    home.hidden = false;
    editor.hidden = false;
    home.inert = next;
    editor.inert = !next;
    const targets = next
      ? ["translateX(0)", "translateX(0)"]
      : ["translateX(0)", "translateX(100%)"];
    const finish = () => {
      if (revision !== currentRevision) return;
      home.hidden = next;
      editor.hidden = !next;
    };
    const style = window.getComputedStyle(editor);
    for (const [i, node] of [home, editor].entries()) {
      node.style.transform = targets[i];
      if (i === 0 || reduced.matches || !node.animate) continue;
      const start =
        starts[i] || (i === 0 ? "translateX(-100%)" : "translateX(100%)");
      effects.push(
        node.animate([{ transform: start }, { transform: targets[i] }], {
          duration: parseFloat(
            style.getPropertyValue("--otoha-motion-duration-expand"),
          ),
          easing: style.getPropertyValue("--otoha-motion-ease-editor").trim(),
        }),
      );
    }
    if (!effects.length) finish();
    else
      Promise.all(
        effects.map((effect) => effect.finished.catch(() => {})),
      ).then(finish);
  };
};
