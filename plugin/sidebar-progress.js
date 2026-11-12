window.createProgressFeedback = (elements, mediaPath) => {
  let job = null;
  let revealTimer = null;
  let hideTimer = null;
  let activeJob = null;
  let visible = false;
  let exitMedia = "";
  let buttonJob = "";
  let buttonPhase = "idle";
  let completionTimer = null;
  let retracted = false;
  let feedbackMedia = "";
  let announcementKey = "";
  const cancel = (timer) => {
    if (timer !== null && typeof window.clearTimeout === "function")
      window.clearTimeout(timer);
  };
  const schedule = (callback, delay) => {
    if (typeof window.setTimeout === "function")
      return window.setTimeout(callback, delay);
    callback();
    return null;
  };
  const duration = (token, fallback) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      return 0;
    if (
      !document.documentElement ||
      typeof window.getComputedStyle !== "function"
    )
      return fallback;
    const value = Number.parseFloat(
      window.getComputedStyle(document.documentElement).getPropertyValue(token),
    );
    return Number.isFinite(value) ? value : fallback;
  };
  function elapsed() {
    const show = job && Number.isFinite(job.startedAt) && job.status !== "idle";
    elements.jobElapsed.hidden = !show;
    if (!show) return;
    const end = Number.isFinite(job.finishedAt) ? job.finishedAt : Date.now();
    const seconds = Math.max(0, Math.floor((end - job.startedAt) / 1000));
    elements.jobElapsed.textContent = `已耗时 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function render(next) {
    if (feedbackMedia !== mediaPath()) {
      cancel(hideTimer);
      cancel(revealTimer);
      hideTimer = revealTimer = null;
      activeJob = null;
      visible = false;
      retracted = false;
      feedbackMedia = mediaPath();
    }
    job = next;
    announce();
    if (job.status !== "completed") retracted = false;
    elapsed();
    renderButton();
    const active = ["running", "loading"].includes(job.status);
    const key = job.jobId || job.startedAt || "active";
    if (active) {
      retracted = false;
      if (activeJob !== key) {
        const reverse = hideTimer !== null && exitMedia === mediaPath();
        cancel(revealTimer);
        revealTimer = null;
        cancel(hideTimer);
        activeJob = key;
        exitMedia = "";
        visible = reverse;
        elements.jobStatus.setAttribute(
          "data-drawer",
          reverse ? "expanded" : "collapsed",
        );
        if (reverse) {
          elements.progressDrawer.classList?.add("is-visible");
          elements.jobStatus.setAttribute("data-drawer", "expanded");
          return;
        }
        elements.progressDrawer.classList?.remove("is-visible");
        elements.progressDrawer.hidden = true;
      }
      cancel(hideTimer);
      if (visible || revealTimer !== null) return;
      revealTimer = schedule(
        () => {
          revealTimer = null;
          if (activeJob !== key) return;
          elements.progressDrawer.hidden = false;
          elements.progress.hidden = false;
          elements.progressDrawer.getBoundingClientRect?.();
          (window.requestAnimationFrame || ((callback) => callback()))(() => {
            if (activeJob !== key) return;
            elements.progressDrawer.classList?.add("is-visible");
            elements.jobStatus.setAttribute("data-drawer", "expanded");
            visible = true;
          });
        },
        duration("--otoha-motion-duration-progress-delay", 180),
      );
      return;
    }
    activeJob = null;
    cancel(revealTimer);
    revealTimer = null;
    if (!visible) {
      if (hideTimer !== null) return;
      elements.jobStatus.setAttribute("data-drawer", "expanded");
      if (job.status === "completed" && buttonPhase === "complete")
        retracted = true;
      elements.progressDrawer.hidden = true;
      elements.progress.hidden = true;
      return;
    }
    elements.progressDrawer.classList?.remove("is-visible");
    elements.jobStatus.setAttribute(
      "data-drawer",
      ["completed", "idle"].includes(job.status) ? "collapsed" : "expanded",
    );
    visible = false;
    exitMedia = job.status === "error" ? mediaPath() : "";
    cancel(hideTimer);
    hideTimer = schedule(
      () => {
        if (activeJob !== null || visible) return;
        elements.progressDrawer.hidden = true;
        elements.progress.hidden = true;
        if (job.status === "completed") {
          retracted = true;
          elements.jobStatus.hidden = true;
        }
        exitMedia = "";
        hideTimer = null;
      },
      duration("--otoha-motion-duration-progress-collapse", 420),
    );
  }
  function announce() {
    const key = JSON.stringify([
      mediaPath(),
      job.jobId || job.startedAt,
      job.status,
      job.phase,
      job.loaded,
      job.path,
      job.errorCode,
      ["error", "load-error"].includes(job.status) ? job.message : null,
    ]);
    if (key === announcementKey) return;
    announcementKey = key;
    let message = job.message || "";
    if (["idle", "available"].includes(job.status)) message = "";
    else if (job.status === "completed" && job.loaded)
      message = job.jobId ? "字幕已生成并加载" : "字幕已加载";
    if (elements.jobAnnouncement.textContent !== message)
      elements.jobAnnouncement.textContent = message;
  }
  function renderButton() {
    const key = `${mediaPath()}\n${job.jobId || job.startedAt || "active"}`;
    const active = ["running", "canceling", "loading"].includes(job.status);
    if (active) {
      cancel(completionTimer);
      completionTimer = null;
      buttonJob = key;
      buttonPhase = "busy";
    } else if (
      job.status === "completed" &&
      buttonJob === key &&
      buttonPhase === "busy"
    ) {
      buttonPhase = "complete";
      completionTimer = schedule(
        () => {
          completionTimer = null;
          buttonPhase = "idle";
          elements.start.setAttribute("data-phase", buttonPhase);
        },
        duration("--otoha-motion-duration-generation-complete", 2000),
      );
    } else if (buttonJob !== key || job.status !== "completed") {
      cancel(completionTimer);
      completionTimer = null;
      buttonPhase = "idle";
    }
    elements.start.setAttribute("data-phase", buttonPhase);
    elements.start.setAttribute(
      "aria-label",
      active ? "正在生成" : elements.start.textContent || "生成",
    );
    elements.jobStatus.setAttribute("data-phase", job.status);
  }
  return {
    render,
    get retracted() {
      return retracted;
    },
    tick() {
      if (job && ["running", "loading"].includes(job.status)) elapsed();
    },
  };
};
