(() => {
  window.createSubtitleCueList = ({
    viewport,
    count,
    videoMarker,
    onSelect,
    onSeek,
  }) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preview = window.createSubtitlePreviewQueue();
    const make = (tag, className) => {
      const node = document.createElement(tag);
      node.className = className;
      return node;
    };
    const track = make("div", "cue-track");
    const highlight = make("span", "cue-highlight");
    const marker = videoMarker || make("span", "cue-video-position");
    for (const node of [highlight, marker])
      node.setAttribute("aria-hidden", "true");
    viewport.append(highlight, track, marker);
    for (const edge of ["top", "bottom"]) {
      const node = make("span", `cue-edge cue-edge-${edge}`);
      node.setAttribute("aria-hidden", "true");
      viewport.append(node);
    }
    let rows = [],
      index = -1,
      videoIndex = -1,
      offset = 0,
      disabled = false,
      follow = true;
    const animations = new Map();
    const style = () => window.getComputedStyle(viewport);
    const height = () =>
      rows[0]?.node.offsetHeight ||
      parseFloat(style().getPropertyValue("--otoha-cue-height"));
    function move(node, target, animate) {
      const initial = window.getComputedStyle(node).transform;
      animations.get(node)?.cancel();
      node.style.transform = `translateY(${target}px)`;
      if (!animate || reduced.matches || !node.animate) return;
      const animation = node.animate(
        [
          { transform: initial === "none" ? "translateY(0px)" : initial },
          { transform: node.style.transform },
        ],
        {
          duration: parseFloat(
            style().getPropertyValue("--otoha-motion-cue-duration"),
          ),
          easing: style().getPropertyValue("--otoha-motion-cue-ease").trim(),
        },
      );
      animations.set(node, animation);
      animation.finished
        .catch(() => {})
        .finally(() => {
          if (animations.get(node) === animation) animations.delete(node);
        });
    }
    function positionMarker(animate) {
      marker.hidden = videoIndex < 0;
      if (videoIndex >= 0)
        move(marker, videoIndex * height() + offset, animate);
    }
    function titles() {
      rows.forEach(({ node }) => {
        node.title = follow
          ? "选择并定位视频到本句起点"
          : "单击选中，双击定位视频到本句起点";
      });
    }
    function renderIndex(previous, animate) {
      if (previous === index) return;
      count.setAttribute(
        "aria-label",
        `第 ${index + 1} 句，共 ${rows.length} 句`,
      );
      const number = make("span", "cue-index-number");
      number.textContent = String(index + 1);
      const indexWindow = make("span", "cue-index-window");
      indexWindow.setAttribute("aria-hidden", "true");
      indexWindow.append(number);
      const total = make("span", "");
      total.textContent = ` / ${rows.length}`;
      total.setAttribute("aria-hidden", "true");
      count.replaceChildren(indexWindow, total);
      if (animate && !reduced.matches && previous >= 0) {
        const direction = Math.sign(index - previous);
        const old = make("span", "cue-index-number");
        old.textContent = String(previous + 1);
        indexWindow.append(old);
        const options = {
          duration: parseFloat(
            style().getPropertyValue("--otoha-motion-cue-index-duration"),
          ),
          easing: style().getPropertyValue("--otoha-motion-cue-ease").trim(),
        };
        old
          .animate(
            [
              { transform: "translateY(0)" },
              { transform: `translateY(${-direction * 100}%)` },
            ],
            options,
          )
          .finished.catch(() => {})
          .then(() => old.remove());
        number.animate(
          [
            { transform: `translateY(${direction * 100}%)` },
            { transform: "translateY(0)" },
          ],
          options,
        );
      }
    }
    function select(position, animate = false) {
      if (!rows.length) return;
      preview.flush();
      const previous = index;
      index = Math.max(0, Math.min(rows.length - 1, position));
      for (const position of new Set([previous, index])) {
        const node = rows[position]?.node;
        if (!node) continue;
        node.classList.toggle("selected", position === index);
        node.setAttribute("aria-selected", String(position === index));
        node.tabIndex = position === index ? 0 : -1;
      }
      const rowHeight = height();
      const minimum = Math.min(
        0,
        viewport.clientHeight - rows.length * rowHeight,
      );
      offset = Math.max(
        minimum,
        Math.min(
          0,
          (viewport.clientHeight - rowHeight) / 2 - index * rowHeight,
        ),
      );
      viewport.classList.toggle("has-cues-before", offset < 0);
      viewport.classList.toggle("has-cues-after", offset > minimum);
      move(track, offset, animate);
      move(highlight, index * rowHeight + offset, animate);
      positionMarker(animate);
      renderIndex(previous, animate);
    }
    function update(
      position,
      text,
      modified,
      composing = false,
      immediate = false,
    ) {
      const row = rows[position];
      if (!row) return;
      if (!composing)
        for (const key of ["source", "translation"])
          preview.update(row[key], text[key], immediate);
      row.dirty.hidden = !modified;
    }
    function replace(cues, drafts, baseline, retainSelection = false) {
      preview.clear();
      animations.forEach((animation) => animation.cancel());
      rows = cues.map((cue, position) => {
        const node = make("div", "cue");
        node.id = `subtitle-cue-${position}`;
        node.setAttribute("role", "option");
        node.setAttribute("aria-selected", "false");
        node.tabIndex = -1;
        const meta = make("div", "cue-meta");
        const timestamp = make("span", "");
        timestamp.textContent = `${String(Math.floor(cue.start / 60)).padStart(2, "0")}:${(cue.start % 60).toFixed(3).padStart(6, "0")}`;
        const dirty = make("span", "unsaved-dot");
        dirty.title = "该句有未保存修改";
        dirty.setAttribute("aria-label", dirty.title);
        meta.append(timestamp, dirty);
        const source = make("p", "cue-source"),
          translation = make("p", "cue-translation");
        node.append(meta, source, translation);
        node.addEventListener("click", () => {
          if (!disabled) onSelect(position);
        });
        node.addEventListener("dblclick", () => {
          if (!disabled && !follow) onSeek(position);
        });
        return { node, source, translation, dirty };
      });
      track.replaceChildren(...rows.map((row) => row.node));
      rows.forEach((row, i) =>
        update(
          i,
          drafts[i],
          JSON.stringify(drafts[i]) !== JSON.stringify(baseline[i]),
          false,
          true,
        ),
      );
      if (!retainSelection) index = -1;
      if (videoIndex >= rows.length) videoIndex = -1;
      titles();
    }
    viewport.addEventListener("keydown", (event) => {
      if (disabled || !rows.length) return;
      const position = {
        ArrowUp: index - 1,
        ArrowDown: index + 1,
        Home: 0,
        End: rows.length - 1,
      }[event.key];
      if (position !== undefined) {
        event.preventDefault();
        if (position >= 0 && position < rows.length) {
          onSelect(position);
          rows[position].node.focus({ preventScroll: true });
        }
      } else if (event.key === "Enter" && !follow) {
        event.preventDefault();
        onSeek(index);
      }
    });
    if (typeof window.ResizeObserver === "function")
      new window.ResizeObserver(() => select(index)).observe(viewport);
    return {
      replace,
      select,
      update,
      setDisabled(value) {
        disabled = value;
        viewport.setAttribute("aria-disabled", String(value));
      },
      setFollow(value) {
        follow = value;
        titles();
      },
      setVideoIndex(value, animate) {
        videoIndex = value;
        positionMarker(animate);
      },
    };
  };
})();
