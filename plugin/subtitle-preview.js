(() => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  function changedRange(before, after) {
    const left = [...segmenter.segment(before)].map((part) => part.segment);
    const right = [...segmenter.segment(after)].map((part) => part.segment);
    let start = 0,
      tail = 0;
    while (
      start < left.length &&
      start < right.length &&
      left[start] === right[start]
    )
      start++;
    while (
      tail < left.length - start &&
      tail < right.length - start &&
      left[left.length - 1 - tail] === right[right.length - 1 - tail]
    )
      tail++;
    return {
      prefix: left.slice(0, start).join(""),
      removed: left.slice(start, left.length - tail).join(""),
      inserted: right.slice(start, right.length - tail).join(""),
      suffix: tail ? left.slice(-tail).join("") : "",
    };
  }
  window.createSubtitlePreviewQueue = () => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const states = new Map();
    function finish(state, value) {
      state.content.textContent = value;
      state.value = value;
      state.element.classList.remove(
        "is-updating-preview",
        "has-preview-overflow",
      );
      state.element.style.removeProperty("--otoha-preview-ellipsis-width");
      delete state.element.dataset.previewStage;
      state.refreshOverflow();
    }
    function flushState(state) {
      state.revision++;
      clearTimeout(state.timer);
      state.timer = null;
      state.animations.forEach((animation) => animation.cancel());
      state.animations.clear();
      state.running = false;
      finish(state, state.latest);
    }
    function schedule(state) {
      if (state.timer || state.running || state.latest === state.value) return;
      const batch = parseFloat(
        window
          .getComputedStyle(state.element)
          .getPropertyValue("--otoha-motion-preview-batch"),
      );
      const delay = Math.max(
        0,
        batch - (performance.now() - state.lastStarted),
      );
      state.timer = setTimeout(() => {
        state.timer = null;
        run(state);
      }, delay);
    }
    function visibleChange(state, range, value) {
      let prefixWidth = 0;
      if (range.prefix && state.content.firstChild) {
        const prefix = document.createRange();
        prefix.setStart(state.content.firstChild, 0);
        prefix.setEnd(state.content.firstChild, range.prefix.length);
        prefixWidth = prefix.getBoundingClientRect().width;
      }
      const probe = document.createElement("span");
      probe.className = "preview-measure";
      state.element.append(probe);
      const widths = [state.value, value, "..."].map((text) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      });
      probe.remove();
      const overflow =
        Math.max(widths[0], widths[1]) > state.element.clientWidth;
      if (prefixWidth >= state.element.clientWidth - (overflow ? widths[2] : 0))
        return false;
      if (overflow) {
        state.element.classList.add("has-preview-overflow");
        state.element.style.setProperty(
          "--otoha-preview-ellipsis-width",
          `${widths[2]}px`,
        );
      }
      return true;
    }
    async function run(state) {
      const revision = ++state.revision,
        value = state.latest;
      state.running = true;
      state.lastStarted = performance.now();
      const range = changedRange(state.value, value);
      state.element.classList.add("is-updating-preview");
      state.refreshOverflow();
      if (!visibleChange(state, range, value)) {
        finish(state, value);
        state.running = false;
        schedule(state);
        return;
      }
      const change = document.createElement("span"),
        removed = document.createElement("span"),
        inserted = document.createElement("span");
      change.className = "preview-change";
      removed.className = "preview-change-text";
      removed.textContent = range.removed;
      inserted.className = "preview-change-text is-measuring";
      inserted.textContent = range.inserted;
      change.append(removed, inserted);
      state.content.replaceChildren(
        document.createTextNode(range.prefix),
        change,
        document.createTextNode(range.suffix),
      );
      const before = removed.getBoundingClientRect().width,
        after = inserted.getBoundingClientRect().width;
      change.style.width = `${before}px`;
      const style = window.getComputedStyle(state.element);
      const duration = (name) => parseFloat(style.getPropertyValue(name));
      const space = duration("--otoha-motion-preview-space");
      const raised = `translateY(-${style.getPropertyValue("--otoha-motion-preview-lift").trim()})`;
      const easing = style.getPropertyValue("--otoha-motion-cue-ease").trim();
      async function animate(element, frames, duration, delay = 0) {
        const animation = element.animate(frames, {
          duration,
          easing,
          delay,
          fill: "both",
        });
        state.animations.add(animation);
        await animation.finished.catch(() => {});
        return state.revision === revision;
      }
      if (range.removed) {
        const strike = document.createElement("span");
        strike.className = "preview-strike";
        strike.setAttribute("aria-hidden", "true");
        removed.append(strike);
        state.element.dataset.previewStage = "striking";
        if (
          !(await animate(
            strike,
            [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
            duration("--otoha-motion-preview-strike"),
          ))
        )
          return;
        state.element.dataset.previewStage = "removing";
        if (
          !(await animate(
            removed,
            [
              { transform: "translateY(0)", opacity: 1 },
              { transform: raised, opacity: 0 },
            ],
            space,
          ))
        )
          return;
      }
      removed.remove();
      inserted.classList.remove("is-measuring");
      inserted.classList.add("is-inserted");
      state.element.dataset.previewStage = "inserting";
      if (range.inserted) {
        const current = await Promise.all([
          animate(
            inserted,
            [
              { transform: raised, opacity: 0 },
              { transform: "translateY(0)", opacity: 1 },
            ],
            space,
          ),
          animate(
            change,
            [{ width: `${before}px` }, { width: `${after}px` }],
            space,
            duration("--otoha-motion-preview-insert-lead"),
          ),
        ]);
        if (current.some((value) => !value)) return;
      } else if (
        !(await animate(
          change,
          [{ width: `${before}px` }, { width: `${after}px` }],
          space,
        ))
      )
        return;
      if (state.revision !== revision) return;
      state.animations.forEach((animation) => animation.cancel());
      state.animations.clear();
      finish(state, value);
      state.running = false;
      schedule(state);
    }
    function update(element, value, immediate = false) {
      let state = states.get(element);
      if (!state) {
        const content = document.createElement("span");
        content.className = "overflow-text";
        content.textContent = element.textContent;
        element.replaceChildren(content);
        state = {
          element,
          content,
          value: content.textContent,
          latest: content.textContent,
          revision: 0,
          running: false,
          lastStarted: performance.now(),
          animations: new Set(),
        };
        state.refreshOverflow = window.attachSubtitleOverflow(element, content);
        states.set(element, state);
      }
      if (!state.running && !state.timer) state.lastStarted = performance.now();
      state.latest = value.replace(/\r\n?|\n/g, " ");
      if (immediate || reduced.matches) flushState(state);
      else if (!state.running && state.value === state.latest) {
        clearTimeout(state.timer);
        state.timer = null;
      } else schedule(state);
    }
    const flush = () =>
      states.forEach((state) => {
        if (state.running || state.timer || state.latest !== state.value)
          flushState(state);
      });
    const onMotionChange = () => {
      if (reduced.matches) flush();
    };
    reduced.addEventListener("change", onMotionChange);
    return {
      update,
      flush,
      clear() {
        flush();
        states.forEach((state) => state.refreshOverflow.destroy());
        states.clear();
      },
    };
  };
})();
