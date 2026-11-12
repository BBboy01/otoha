(() => {
  window.attachSubtitleOverflow = (element, content) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations = [],
      repeat,
      hovered = false;
    function stop() {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      repeat?.remove();
      element.classList.remove("is-scrolling-text");
    }
    function update() {
      stop();
      const text = content.textContent;
      const distance = Math.max(0, content.scrollWidth - element.clientWidth);
      element.title = distance ? text : "";
      if (
        element.classList.contains("is-updating-preview") ||
        !hovered ||
        !distance ||
        reduced.matches
      )
        return;
      const style = window.getComputedStyle(element);
      element.classList.add("is-scrolling-text");
      const contentWidth = content.getBoundingClientRect().width;
      repeat = document.createElement("span");
      repeat.className = "overflow-repeat";
      repeat.textContent = text;
      repeat.setAttribute("aria-hidden", "true");
      element.append(repeat);
      const period = repeat.getBoundingClientRect().width;
      const duration =
        (period /
          parseFloat(style.getPropertyValue("--otoha-motion-overflow-speed"))) *
        1000;
      const options = {
        duration,
        delay: parseFloat(
          style.getPropertyValue("--otoha-motion-overflow-delay"),
        ),
        iterations: Infinity,
        easing: "linear",
        fill: "both",
      };
      animations = [
        content.animate(
          [
            { transform: "translateX(0)" },
            { transform: `translateX(-${period}px)` },
          ],
          options,
        ),
        repeat.animate(
          [
            { transform: `translateX(${contentWidth}px)` },
            { transform: `translateX(${contentWidth - period}px)` },
          ],
          options,
        ),
      ];
      animations.forEach((animation) => {
        animation.startTime = document.timeline.currentTime;
      });
    }
    const enter = () => {
      hovered = true;
      update();
    };
    const leave = () => {
      hovered = false;
      stop();
    };
    element.addEventListener("mouseenter", enter);
    element.addEventListener("mouseleave", leave);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    reduced.addEventListener("change", update);
    update.destroy = () => {
      stop();
      observer.disconnect();
      element.removeEventListener("mouseenter", enter);
      element.removeEventListener("mouseleave", leave);
      reduced.removeEventListener("change", update);
    };
    return update;
  };
})();
