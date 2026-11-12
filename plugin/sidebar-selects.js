(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const controls = [];
  for (const select of document.querySelectorAll("select:not([size])")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "select-trigger";
    button.dataset.selectFor = select.id;
    button.id = `${select.id}-trigger`;
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("div");
    menu.className = "select-menu";
    menu.id = `${select.id}-menu`;
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    button.setAttribute("aria-controls", menu.id);
    const label = select.labels?.[0];
    if (label) {
      label.id ||= `${select.id}-label`;
      label.htmlFor = button.id;
      button.setAttribute("aria-labelledby", label.id);
      menu.setAttribute("aria-labelledby", label.id);
    } else {
      button.setAttribute(
        "aria-label",
        select.getAttribute("aria-label") || "选择",
      );
      menu.setAttribute(
        "aria-label",
        select.getAttribute("aria-label") || "选择",
      );
    }
    select.after(button);
    document.body.append(menu);
    select.hidden = true;
    let opened = false,
      index = 0,
      effect,
      revision = 0,
      optionsKey = "";
    const key = () =>
      JSON.stringify([
        select.disabled,
        select.value,
        [...select.options].map((option) => [
          option.value,
          option.text,
          option.disabled,
        ]),
      ]);
    function sync() {
      const option = select.selectedOptions[0];
      button.textContent = option?.text || "选择";
      button.title = select.title || option?.text || "";
      button.disabled = select.disabled;
      for (const attribute of [
        "aria-describedby",
        "aria-invalid",
        "aria-required",
      ]) {
        const value = select.getAttribute(attribute);
        if (value) button.setAttribute(attribute, value);
        else button.removeAttribute(attribute);
      }
      if (select.required) button.setAttribute("aria-required", "true");
      if (opened && select.disabled) close(true);
    }
    function animate(show, immediate = false) {
      const token = ++revision;
      const style = window.getComputedStyle(menu);
      const scale = style
        .getPropertyValue("--otoha-motion-select-scale")
        .trim();
      const initial = effect
        ? { opacity: style.opacity, transform: style.transform }
        : { opacity: show ? 0 : 1, transform: `scale(${show ? scale : 1})` };
      effect?.cancel();
      if (reduced.matches || immediate) {
        menu.hidden = !show;
        return;
      }
      effect = menu.animate(
        [
          initial,
          { opacity: show ? 1 : 0, transform: `scale(${show ? 1 : scale})` },
        ],
        {
          duration: parseFloat(
            style.getPropertyValue("--otoha-motion-duration-expand"),
          ),
          easing: style.getPropertyValue("--otoha-motion-ease-standard").trim(),
        },
      );
      effect.finished
        .catch(() => {})
        .then(() => {
          if (revision === token && !opened) menu.hidden = true;
        });
    }
    function close(immediate = false) {
      if (!opened) return;
      opened = false;
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-activedescendant");
      animate(false, immediate);
    }
    function active(position) {
      const options = [...select.options];
      index = Math.max(0, Math.min(options.length - 1, position));
      if (options[index]?.disabled) return;
      [...menu.children].forEach((item, i) =>
        item.classList.toggle("active", i === index),
      );
      button.setAttribute("aria-activedescendant", `${menu.id}-${index}`);
      menu.children[index]?.scrollIntoView({ block: "nearest" });
    }
    function choose(position) {
      if (
        select.disabled ||
        !select.options[position] ||
        select.options[position].disabled
      )
        return;
      select.selectedIndex = position;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      close();
      button.focus();
    }
    function open() {
      if (select.disabled || !select.options.length) return;
      controls.forEach((control) => control.close(true));
      optionsKey = key();
      menu.replaceChildren(
        ...[...select.options].map((option, i) => {
          const item = document.createElement("div");
          item.id = `${menu.id}-${i}`;
          item.textContent = option.text;
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(option.selected));
          item.setAttribute("aria-disabled", String(option.disabled));
          item.addEventListener("mousedown", (event) => event.preventDefault());
          item.addEventListener("click", () => choose(i));
          return item;
        }),
      );
      menu.hidden = false;
      opened = true;
      button.setAttribute("aria-expanded", "true");
      const rect = button.getBoundingClientRect();
      menu.style.width = `${rect.width}px`;
      menu.style.left = `${rect.left}px`;
      menu.style.top = "auto";
      menu.style.bottom = "auto";
      menu.style.removeProperty("max-height");
      const below = innerHeight - rect.bottom;
      const above = rect.top;
      const height = Math.min(
        parseFloat(window.getComputedStyle(menu).maxHeight),
        Math.max(below, above),
      );
      menu.style.maxHeight = `${height}px`;
      if (below >= Math.min(height, menu.scrollHeight)) {
        menu.style.top = `${rect.bottom}px`;
        menu.style.transformOrigin = "center top";
      } else {
        menu.style.bottom = `${innerHeight - rect.top}px`;
        menu.style.transformOrigin = "center bottom";
      }
      active(
        select.options[select.selectedIndex]?.disabled
          ? [...select.options].findIndex((option) => !option.disabled)
          : Math.max(0, select.selectedIndex),
      );
      animate(true);
    }
    button.addEventListener("click", () => (opened ? close() : open()));
    let search = "",
      searchedAt = 0;
    button.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!opened) open();
        else {
          const direction =
            event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
          let position =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? select.options.length - 1
                : index + direction;
          while (
            position >= 0 &&
            position < select.options.length &&
            select.options[position].disabled
          )
            position += direction;
          active(position);
        }
      } else if (opened && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        choose(index);
      } else if (opened && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") close();
      else if (
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const now = performance.now();
        search = now - searchedAt > 700 ? event.key : search + event.key;
        searchedAt = now;
        const position = [...select.options].findIndex(
          (option) =>
            !option.disabled &&
            option.text
              .toLocaleLowerCase()
              .startsWith(search.toLocaleLowerCase()),
        );
        if (position >= 0) {
          event.preventDefault();
          if (!opened) open();
          active(position);
        }
      }
    });
    select.addEventListener("change", sync);
    select.addEventListener("invalid", (event) => {
      event.preventDefault();
      button.focus();
    });
    new MutationObserver(() => {
      if (opened && key() !== optionsKey) close(true);
      sync();
    }).observe(select, { childList: true, subtree: true, attributes: true });
    document.addEventListener("click", (event) => {
      if (!button.contains(event.target) && !menu.contains(event.target))
        close();
    });
    document.addEventListener(
      "scroll",
      (event) => {
        if (event.target !== menu && !menu.contains(event.target)) close(true);
      },
      true,
    );
    window.addEventListener("resize", () => close(true));
    controls.push({ sync, close });
    sync();
  }
  window.sidebarSelects = {
    refresh: () => controls.forEach((control) => control.sync()),
  };
})();
