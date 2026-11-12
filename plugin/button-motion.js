(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const animations = new Map();
  function controlFor(event) {
    const control = event.target.closest?.("button");
    if (
      !control ||
      reducedMotion.matches ||
      control.matches(
        ':disabled, [aria-disabled="true"], [role="radio"], [role="combobox"], [role="option"]',
      )
    )
      return null;
    return control;
  }
  function prepare(control) {
    const { offsetWidth: width, offsetHeight: height } = control;
    if (!width || !height) return;
    const style = window.getComputedStyle(control);
    const press = parseFloat(
      style.getPropertyValue("--otoha-motion-press-distance"),
    );
    const rebound = parseFloat(
      style.getPropertyValue("--otoha-motion-rebound-distance"),
    );
    control.style.setProperty(
      "--otoha-motion-press-scale",
      `${Math.max(0, 1 - press / width)} ${Math.max(0, 1 - press / height)}`,
    );
    control.style.setProperty(
      "--otoha-motion-rebound-scale",
      `${1 + rebound / width} ${1 + rebound / height}`,
    );
  }
  for (const name of ["pointerdown", "keydown"]) {
    document.addEventListener(
      name,
      (event) => {
        if (name === "keydown" && event.key !== " " && event.key !== "Enter")
          return;
        const control = controlFor(event);
        if (!control) return;
        animations.get(control)?.cancel();
        prepare(control);
      },
      true,
    );
  }
  document.addEventListener(
    "click",
    (event) => {
      const control = controlFor(event);
      if (!control || !control.animate) return;
      prepare(control);
      const style = window.getComputedStyle(control);
      const initial = style.scale === "none" ? "1" : style.scale;
      animations.get(control)?.cancel();
      const animation = control.animate(
        [
          { scale: initial },
          {
            scale: style.getPropertyValue("--otoha-motion-press-scale").trim(),
            offset: 0.2,
          },
          {
            scale: style
              .getPropertyValue("--otoha-motion-rebound-scale")
              .trim(),
            offset: 0.65,
          },
          { scale: "1" },
        ],
        {
          duration: parseFloat(
            style.getPropertyValue("--otoha-motion-rebound-duration"),
          ),
          easing: style.getPropertyValue("--otoha-motion-press-ease").trim(),
        },
      );
      animations.set(control, animation);
      animation.finished
        .catch(() => {})
        .finally(() => {
          if (animations.get(control) === animation) animations.delete(control);
        });
    },
    true,
  );
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches)
      animations.forEach((animation) => animation.cancel());
  });
})();
