function createSidebarLifecycle({
  isLoaded,
  isWindowLoaded,
  load,
  schedule = setTimeout,
  delays = [0, 100, 250, 500, 1000, 2000, 4000, 8000],
  pageLoadDelay = 500,
}) {
  let retryPending = false;
  let retryIndex = 0;
  let pageLoadPending = false;
  let loadRequested = false;
  let showRequested = false;

  function scheduleRetry() {
    if (isLoaded() || retryPending || pageLoadPending || loadRequested) return;
    const delay = delays[Math.min(retryIndex, delays.length - 1)];
    retryIndex += 1;
    retryPending = true;
    schedule(() => {
      retryPending = false;
      initialize();
    }, delay);
  }

  function initialize(show = false) {
    showRequested = showRequested || show;
    if (isLoaded() || pageLoadPending || loadRequested) return;
    if (!isWindowLoaded()) {
      scheduleRetry();
      return;
    }
    pageLoadPending = true;
    schedule(() => {
      pageLoadPending = false;
      if (!isLoaded() && !loadRequested) load(showRequested);
    }, pageLoadDelay);
  }

  return {
    initialize,
    scheduleRetry,
    markLoadStarted() {
      loadRequested = true;
      showRequested = false;
    },
    markLoadFinished() {
      loadRequested = false;
      retryIndex = 0;
    },
    reset() {
      retryPending = false;
      pageLoadPending = false;
      loadRequested = false;
      showRequested = false;
      retryIndex = 0;
    },
    state() {
      return { retryPending, pageLoadPending, loadRequested, showRequested, retryIndex };
    },
  };
}

module.exports = { createSidebarLifecycle };
